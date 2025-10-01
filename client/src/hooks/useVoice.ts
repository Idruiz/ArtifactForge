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

  useEffect(() => {
    const SR: any =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    setIsSupported(true);
    const rec: SpeechRecognition = new SR();
    rec.lang = "en-US";
    rec.continuous = isCarMode; // Only continuous in car mode
    rec.interimResults = isCarMode; // Only interim in car mode

    rec.onresult = (e: any) => {
      // Get only the new transcript (latest result)
      const latestIndex = e.resultIndex;
      const latestResult = e.results[latestIndex];
      const transcript = latestResult[0].transcript;
      
      if (isCarMode && onCarModeAutoSend) {
        // Car Mode: accumulate and set silence timer
        currentTranscriptRef.current = transcript;
        
        // Clear existing silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }
        
        // Start 3-second silence timer
        silenceTimerRef.current = setTimeout(() => {
          if (currentTranscriptRef.current) {
            onCarModeAutoSend(currentTranscriptRef.current);
            // Reset transcript and restart recognition to clear buffer
            currentTranscriptRef.current = "";
            try {
              rec.stop();
              setTimeout(() => {
                try {
                  rec.start();
                } catch (err) {
                  console.error("Error restarting recognition:", err);
                }
              }, 100);
            } catch (err) {
              console.error("Error stopping recognition:", err);
            }
          }
        }, 3000);
      } else {
        // Normal mode - immediate callback and stop
        onResult(transcript);
        rec.stop();
        setIsListening(false);
      }
    };
    
    rec.onend = () => {
      if (isCarMode) {
        // Restart listening in car mode
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
    
    // Clean up on unmount or when car mode changes
    return () => {
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
      recognition.start();
      setIsListening(true);
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
