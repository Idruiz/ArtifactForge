import { useState, useCallback, useEffect, useRef } from "react";

interface UseVoiceReturn {
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  isSpeaking: boolean;
  startCarMode: () => void;
  stopCarMode: () => void;
  isCarMode: boolean;
}

export function useVoice(
  onResult: (text: string) => void,
  onCarModeAutoSend?: (text: string) => void
): UseVoiceReturn {
  // ──────────────────────────────────────────────
  // Speech‑to‑text (browser Web Speech API)
  // ──────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isCarMode, setIsCarMode] = useState(false);
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(
    null,
  );
  
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentTranscriptRef = useRef<string>("");
  const recRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const SR: any =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    setIsSupported(true);
    const rec: SpeechRecognition = new SR();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = isCarMode;
    rec.interimResults = isCarMode;

    rec.onresult = (e: any) => {
      if (isCarMode && onCarModeAutoSend) {
        // Car Mode: build full transcript from all results
        let fullTranscript = "";
        for (let i = 0; i < e.results.length; i++) {
          fullTranscript += e.results[i][0].transcript;
        }
        
        currentTranscriptRef.current = fullTranscript;
        
        // Clear existing silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }
        
        // Start 3-second silence timer
        silenceTimerRef.current = setTimeout(() => {
          const finalText = currentTranscriptRef.current.trim();
          if (finalText) {
            onCarModeAutoSend(finalText);
            currentTranscriptRef.current = "";
            // Stop and restart to clear buffer - onend will handle restart
            try {
              if (rec === recRef.current) {
                rec.stop();
              }
            } catch (err) {
              console.error("Error stopping recognition:", err);
            }
          }
        }, 3000);
      } else {
        // Normal mode - get final transcript and stop
        const latestIndex = e.resultIndex;
        const transcript = e.results[latestIndex][0].transcript;
        onResult(transcript);
        rec.stop();
        setIsListening(false);
      }
    };
    
    rec.onstart = () => {
      setIsListening(true);
    };
    
    rec.onend = () => {
      if (isCarMode && rec === recRef.current) {
        // Only restart if this is the current recognition in car mode
        try {
          rec.start();
        } catch (e: any) {
          if (e.message && !e.message.includes("already started")) {
            console.error("Error restarting recognition:", e);
            setIsListening(false);
          }
        }
      } else {
        setIsListening(false);
      }
    };
    
    rec.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.error("Recognition error:", e);
        setIsListening(false);
      }
    };

    setRecognition(rec);
    
    // Start immediately if in car mode
    if (isCarMode && !isListening) {
      try {
        rec.start();
        setIsListening(true);
      } catch (e) {
        console.error("Failed to start recognition:", e);
      }
    }
    
    // Clean up on unmount or when car mode changes
    return () => {
      // Prevent auto-restart during cleanup
      rec.onend = null;
      try {
        rec.stop();
      } catch (e) {
        // Ignore errors when stopping
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, [onResult, isCarMode, onCarModeAutoSend]);

  const startListening = useCallback(() => {
    if (recognition && !isListening) {
      recognition.start();
      setIsListening(true);
    }
  }, [recognition, isListening]);

  const stopListening = useCallback(() => {
    recognition?.stop();
    setIsListening(false);
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
  }, [recognition]);

  const startCarMode = useCallback(() => {
    if (recognition && !isListening) {
      setIsCarMode(true);
      // Effect will handle starting the new recognition
    }
  }, [recognition, isListening]);

  const stopCarMode = useCallback(() => {
    setIsCarMode(false);
    recognition?.stop();
    setIsListening(false);
    currentTranscriptRef.current = "";
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
  }, [recognition]);

  // ──────────────────────────────────────────────
  // Text‑to‑speech via OpenAI TTS endpoint
  // ──────────────────────────────────────────────
  const [isSpeaking, setIsSpeaking] = useState(false);

  const speak = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "alloy" }), // you can change to "echo", "nova"…
      });
      if (!r.ok) throw new Error(`TTS ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
      };
      audio.play();
    } catch (err) {
      console.error("[tts]", err);
      setIsSpeaking(false);
    }
  }, []);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
    speak,
    isSpeaking,
    startCarMode,
    stopCarMode,
    isCarMode,
  };
}
