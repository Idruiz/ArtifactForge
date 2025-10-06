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

        if (speaking && !vadActiveRef.current) {
          vadActiveRef.current = true;
          chunksRef.current = [];
          rec.start();
          console.log("🎙️ voice detected");
          if (vadTimerRef.current) { window.clearTimeout(vadTimerRef.current); vadTimerRef.current = null; }
        } else if (!speaking && vadActiveRef.current) {
          if (!vadTimerRef.current) {
            vadTimerRef.current = window.setTimeout(() => {
              vadActiveRef.current = false;
              try { rec.stop(); } catch {}
              console.log("🛑 silence — sending chunk");
              vadTimerRef.current = null;
            }, vadSilenceMs) as any;
          }
        }
      };

      src.connect(meter);
      meter.connect(ctx.destination);

      setIsCarMode(true);
      console.log("[Car Mode] Started with 3s pause detection");
    } catch (e: any) {
      console.error("[Car Mode] Error:", e.message);
    }
  }

  function stopCarMode() {
    setIsCarMode(false);
    if (meterRef.current) { meterRef.current.disconnect(); meterRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    if (recRef.current && recRef.current.state !== "inactive") { try { recRef.current.stop(); } catch {} }
    if (mediaRef.current) { mediaRef.current.getTracks().forEach(t => t.stop()); mediaRef.current = null; }
    console.log("[Car Mode] Stopped");
  }

  async function flushChunk() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    
    if (blob.size < 500) { 
      console.log(`⚠️ chunk too small: ${blob.size} bytes`);
      return;
    }
    
    if (!isCarMode) return;

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

  const speak = useCallback((msg: string) => {
    try {
      const u = new SpeechSynthesisUtterance(msg);
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  return {
    isCarMode,
    startCarMode,
    stopCarMode,
    speak,
  };
}
