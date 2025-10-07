import { useState, useRef, useCallback } from "react";

interface UseCarModeReturn {
  isCarMode: boolean;
  startCarMode: () => Promise<void>;
  stopCarMode: () => void;
  speak: (text: string) => void;
}

export function useCarMode(
  onTranscript: (text: string) => void
): UseCarModeReturn {
  const [isCarMode, setIsCarMode] = useState(false);
  
  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const vadActiveRef = useRef(false);
  const vadTimerRef = useRef<number | null>(null);
  const meterRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastSpeechTimeRef = useRef<number>(0);

  const vadSilenceMs = 3000; // 3 seconds as requested

  async function startCarMode() {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = media;

      const rec = new MediaRecorder(media, { mimeType: "audio/webm" });
      recRef.current = rec;

      rec.ondataavailable = (e) => { 
        if (e.data.size > 0) chunksRef.current.push(e.data); 
      };

      rec.onstop = () => { flushChunk(); };

      // VAD setup
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      
      await ctx.resume(); // CRITICAL: Resume AudioContext
      
      const src = ctx.createMediaStreamSource(media);
      const meter = ctx.createScriptProcessor(2048, 1, 1);
      meterRef.current = meter;
      
      meter.onaudioprocess = (e) => {
        const buf = e.inputBuffer.getChannelData(0);
        let sum = 0;
        let zc = 0;
        for (let i = 0; i < buf.length; i++) {
          sum += buf[i] * buf[i];
          if (i > 0 && buf[i - 1] * buf[i] < 0) zc++;
        }
        const energy = Math.sqrt(sum / buf.length);
        const speaking = energy > 0.008 && zc > 15;
        const now = performance.now();

        if (speaking) {
          // Update last speech timestamp
          lastSpeechTimeRef.current = now;
          
          if (!vadActiveRef.current) {
            vadActiveRef.current = true;
            chunksRef.current = [];
            // Start recording when voice detected
            if (rec.state === "inactive") {
              rec.start();
              console.log("🎙️ voice detected - recording started");
            }
          }
        } else if (vadActiveRef.current) {
          // Check if we've had sustained silence (3 seconds since last speech)
          const silenceDuration = now - lastSpeechTimeRef.current;
          
          if (silenceDuration >= vadSilenceMs) {
            // Sustained silence detected - stop recording
            vadActiveRef.current = false;
            if (rec.state === "recording") {
              try { rec.stop(); } catch {}
              console.log(`🛑 sustained ${(silenceDuration/1000).toFixed(1)}s silence — sending chunk`);
            }
          }
        }
      };

      // Connect VAD to audio graph without feedback (using zero-gain node)
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0; // Silence output to prevent feedback
      
      src.connect(meter);
      meter.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      setIsCarMode(true);
      console.log("[Car Mode] Started with 3s pause detection - speak to begin");
    } catch (e: any) {
      console.error("[Car Mode] Error:", e.message);
    }
  }

  function stopCarMode() {
    setIsCarMode(false);
    
    // Clear VAD timer to prevent stray callbacks
    if (vadTimerRef.current) {
      window.clearTimeout(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    
    vadActiveRef.current = false;
    
    // Flush any pending audio before stopping
    if (recRef.current && recRef.current.state === "recording") {
      try { 
        recRef.current.stop(); // This will trigger onstop -> flushChunk
      } catch {}
    }
    
    // Clean up all resources and set refs to null
    if (meterRef.current) { meterRef.current.disconnect(); meterRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    if (mediaRef.current) { mediaRef.current.getTracks().forEach(t => t.stop()); mediaRef.current = null; }
    
    // CRITICAL: Set recRef to null so new MediaRecorder is created on restart
    recRef.current = null;
    
    // Stop any TTS playback
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
      currentSourceRef.current = null;
    }
    if (audioCtxForPlaybackRef.current) {
      try { audioCtxForPlaybackRef.current.close(); } catch {}
      audioCtxForPlaybackRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    
    console.log("[Car Mode] Stopped");
  }

  async function flushChunk() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    
    if (blob.size < 500) { 
      console.log(`⚠️ chunk too small: ${blob.size} bytes`);
      return;
    }
    
    // Don't skip if Car Mode was just turned off - we want the final chunk

    console.log(`📤 sending ${blob.size} bytes to STT...`);
    
    const fd = new FormData();
    fd.append("audio", blob, "chunk.webm");

    try {
      const r = await fetch("/car-v2/stt", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) { 
        console.error("STT fail:", data.error || r.status); 
        return; 
      }
      const text = (data.text || "").trim();
      if (!text) { 
        console.log("…(silence)"); 
        return; 
      }

      console.log("you: " + text);
      onTranscript(text); // Send to chat
    } catch (e: any) {
      console.error("STT error:", e.message);
    }
  }

  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const audioCtxForPlaybackRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const speak = useCallback(async (msg: string) => {
    try {
      // Add to queue
      audioQueueRef.current.push(msg);
      
      // If already playing, return (queue will process)
      if (isPlayingRef.current) return;
      
      // Process queue
      while (audioQueueRef.current.length > 0) {
        const text = audioQueueRef.current.shift();
        if (!text) continue;
        
        isPlayingRef.current = true;
        
        console.log("[Car Mode TTS] Fetching OpenAI audio for:", text.substring(0, 50) + "...");
        
        // Fetch TTS audio from OpenAI via our backend
        const r = await fetch("/car-v2/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        
        if (!r.ok) {
          const errorText = await r.text();
          console.error("[Car Mode TTS] ❌ OpenAI TTS endpoint failed:", r.status, errorText);
          console.error("[Car Mode TTS] ❌ NO FALLBACK - Audio will NOT play");
          isPlayingRef.current = false;
          continue;
        }
        
        const contentType = r.headers.get("content-type");
        console.log("[Car Mode TTS] ✅ Received audio response, Content-Type:", contentType);
        
        // Get audio buffer and play
        const arrayBuffer = await r.arrayBuffer();
        console.log("[Car Mode TTS] Audio buffer size:", arrayBuffer.byteLength, "bytes");
        
        if (!audioCtxForPlaybackRef.current) {
          audioCtxForPlaybackRef.current = new AudioContext();
        }
        
        const ctx = audioCtxForPlaybackRef.current;
        await ctx.resume();
        
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        console.log("[Car Mode TTS] 🎵 Playing OpenAI audio (duration:", audioBuffer.duration.toFixed(2), "seconds)");
        
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        
        currentSourceRef.current = source;
        
        // Wait for audio to finish playing
        await new Promise<void>((resolve) => {
          source.onended = () => {
            console.log("[Car Mode TTS] ✅ Audio playback completed");
            isPlayingRef.current = false;
            resolve();
          };
          source.start(0);
        });
      }
    } catch (e: any) {
      console.error("[Car Mode TTS] ❌ CRITICAL ERROR:", e.message, e.stack);
      console.error("[Car Mode TTS] ❌ This should NEVER trigger browser voices");
      isPlayingRef.current = false;
    }
  }, []);

  return {
    isCarMode,
    startCarMode,
    stopCarMode,
    speak,
  };
}
