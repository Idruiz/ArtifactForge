import { useState, useCallback, useEffect, useRef } from "react";

type CarModeState = "IDLE" | "LISTENING" | "TRANSCRIBING" | "SENDING" | "THINKING" | "SPEAKING";

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
  carModeState: CarModeState;
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
  const [carModeState, setCarModeState] = useState<CarModeState>("IDLE");
  const [recognition, setRecognition] = useState<any>(null);
  
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentTranscriptRef = useRef<string>("");
  const recRef = useRef<any>(null);
  const carModeStateRef = useRef<CarModeState>("IDLE");
  const thinkingWatchdogRef = useRef<NodeJS.Timeout | null>(null);

  // FSM transition helper
  const transitionTo = useCallback((newState: CarModeState) => {
    const oldState = carModeStateRef.current;
    console.log(`[Car Mode FSM] ${oldState} → ${newState}`);
    carModeStateRef.current = newState;
    setCarModeState(newState);
  }, []);

  useEffect(() => {
    const SR: any =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    setIsSupported(true);
    const rec: any = new SR();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = isCarMode;
    rec.interimResults = isCarMode;

    rec.onresult = (e: any) => {
      if (isCarMode && onCarModeAutoSend) {
        // LISTENING → TRANSCRIBING
        if (carModeStateRef.current === "LISTENING") {
          transitionTo("TRANSCRIBING");
        }

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
          if (finalText && carModeStateRef.current === "TRANSCRIBING") {
            // TRANSCRIBING → SENDING
            transitionTo("SENDING");
            
            onCarModeAutoSend(finalText);
            currentTranscriptRef.current = "";
            
            // SENDING → THINKING (waiting for assistant response)
            transitionTo("THINKING");
            
            // Start watchdog timer for stuck THINKING state (90s)
            thinkingWatchdogRef.current = setTimeout(() => {
              if (carModeStateRef.current === "THINKING") {
                console.warn("[Car Mode FSM] Watchdog: THINKING timeout, returning to IDLE");
                transitionTo("IDLE");
                // Try to restart recognition
                if (rec === recRef.current && !isListening) {
                  try {
                    rec.start();
                    setIsListening(true);
                  } catch (e) {
                    console.error("Watchdog restart failed:", e);
                  }
                }
              }
            }, 90000);
            
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
      if (isCarMode && carModeStateRef.current === "IDLE") {
        transitionTo("LISTENING");
      }
    };
    
    rec.onend = () => {
      // Always reset isListening first
      setIsListening(false);
      
      if (isCarMode && rec === recRef.current) {
        // Restart if in LISTENING, TRANSCRIBING, or IDLE for reliability
        const state = carModeStateRef.current;
        if (state === "LISTENING" || state === "TRANSCRIBING" || state === "IDLE") {
          try {
            rec.start();
            setIsListening(true);
          } catch (e: any) {
            if (e.message && !e.message.includes("already started")) {
              console.error("Error restarting recognition:", e);
              transitionTo("IDLE");
            }
          }
        }
      }
    };
    
    rec.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.error("Recognition error:", e);
        setIsListening(false);
        if (isCarMode) {
          transitionTo("IDLE");
        }
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
      // Reset isListening to allow autostart on next effect run
      setIsListening(false);
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (thinkingWatchdogRef.current) {
        clearTimeout(thinkingWatchdogRef.current);
      }
    };
  }, [onResult, isCarMode, onCarModeAutoSend, transitionTo]);

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
    setIsCarMode(true);
    transitionTo("IDLE");
    // Effect will handle creating/starting recognition when ready
  }, [transitionTo]);

  const stopCarMode = useCallback(() => {
    setIsCarMode(false);
    transitionTo("IDLE");
    recognition?.stop();
    setIsListening(false);
    currentTranscriptRef.current = "";
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    if (thinkingWatchdogRef.current) {
      clearTimeout(thinkingWatchdogRef.current);
    }
  }, [recognition, transitionTo]);

  // ──────────────────────────────────────────────
  // Text‑to‑speech via OpenAI TTS endpoint
  // ──────────────────────────────────────────────
  const [isSpeaking, setIsSpeaking] = useState(false);

  const speak = useCallback(async (text: string) => {
    try {
      // Clear watchdog timer when speak is called
      if (thinkingWatchdogRef.current) {
        clearTimeout(thinkingWatchdogRef.current);
        thinkingWatchdogRef.current = null;
      }
      
      // THINKING → SPEAKING (when assistant reply is ready to be spoken)
      if (carModeStateRef.current === "THINKING") {
        transitionTo("SPEAKING");
      }
      
      setIsSpeaking(true);
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "alloy" }),
      });
      if (!r.ok) throw new Error(`TTS ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        
        // SPEAKING → IDLE → LISTENING (restart cycle)
        if (isCarMode && carModeStateRef.current === "SPEAKING") {
          transitionTo("IDLE");
          // Explicitly restart recognition (isListening should be false by now from onend)
          if (recRef.current) {
            try {
              recRef.current.start();
              setIsListening(true);
            } catch (e) {
              console.error("Failed to restart recognition after TTS:", e);
            }
          }
        }
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        
        // Error recovery: return to IDLE
        if (isCarMode) {
          transitionTo("IDLE");
        }
      };
      audio.play();
    } catch (err) {
      console.error("[tts]", err);
      setIsSpeaking(false);
      
      // Error recovery: return to IDLE
      if (isCarMode) {
        transitionTo("IDLE");
      }
    }
  }, [isCarMode, transitionTo]);

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
    carModeState,
  };
}
