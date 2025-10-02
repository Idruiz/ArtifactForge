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

const SILENCE_TIMEOUT_MS = 3000; // 3 seconds
const THINKING_WATCHDOG_MS = 90000; // 90 seconds

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
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Refs for stable access in event handlers
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const thinkingWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const currentTranscriptRef = useRef<string>("");
  const carModeStateRef = useRef<CarModeState>("IDLE");
  const isCarModeRef = useRef<boolean>(false);
  const shouldAutoRestartRef = useRef<boolean>(true); // Flag to prevent restart after explicit stop
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // FSM transition helper with structured logging
  const transitionTo = useCallback((newState: CarModeState, reason?: string) => {
    const oldState = carModeStateRef.current;
    const timestamp = new Date().toISOString();
    console.log(`[Car Mode FSM] ${timestamp} | ${oldState} → ${newState}${reason ? ` | ${reason}` : ""}`);
    carModeStateRef.current = newState;
    setCarModeState(newState);
  }, []);

  // Clear all timers
  const clearAllTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (thinkingWatchdogRef.current) {
      clearTimeout(thinkingWatchdogRef.current);
      thinkingWatchdogRef.current = null;
    }
  }, []);

  // Stop recognition cleanly
  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        shouldAutoRestartRef.current = false; // Prevent auto-restart
        recognitionRef.current.stop();
      } catch (e) {
        console.error("[useVoice] Error stopping recognition:", e);
      }
    }
    setIsListening(false);
  }, []);

  // Start recognition with error handling
  const startRecognition = useCallback(() => {
    if (!recognitionRef.current || !isCarModeRef.current) return;
    
    try {
      shouldAutoRestartRef.current = true; // Allow auto-restart
      recognitionRef.current.start();
      setIsListening(true);
      console.log("[Car Mode] Recognition started");
    } catch (e: any) {
      if (!e.message?.includes("already started")) {
        console.error("[Car Mode] Failed to start recognition:", e);
        transitionTo("IDLE", "start failed");
      }
    }
  }, [transitionTo]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn("[useVoice] Speech Recognition not supported");
      return;
    }

    setIsSupported(true);
    const rec: any = new SR();
    recognitionRef.current = rec;
    
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    // ────────── onresult: Handle speech results ──────────
    rec.onresult = (e: any) => {
      if (!isCarModeRef.current || !onCarModeAutoSend) {
        // Normal mode: get final transcript
        // Don't stop here - let the recognition end naturally and onend will handle cleanup
        const latestIndex = e.resultIndex;
        const transcript = e.results[latestIndex][0].transcript;
        if (e.results[latestIndex].isFinal) {
          onResult(transcript);
          // Stop recognition after getting final result
          shouldAutoRestartRef.current = false;
          rec.stop();
        }
        return;
      }

      // Car Mode: Accumulate transcript
      if (carModeStateRef.current === "IDLE" || carModeStateRef.current === "LISTENING") {
        transitionTo("TRANSCRIBING", "speech detected");
      }

      // Build full transcript from all results
      let fullTranscript = "";
      for (let i = 0; i < e.results.length; i++) {
        fullTranscript += e.results[i][0].transcript;
      }
      
      currentTranscriptRef.current = fullTranscript;
      
      // Clear existing silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      
      // Start new silence timer (3 seconds)
      silenceTimerRef.current = setTimeout(() => {
        const finalText = currentTranscriptRef.current.trim();
        
        // Only send if we have text and we're in TRANSCRIBING state
        if (finalText && carModeStateRef.current === "TRANSCRIBING") {
          console.log(`[Car Mode] Silence detected, sending: "${finalText}"`);
          
          // TRANSCRIBING → SENDING
          transitionTo("SENDING", "silence timeout");
          
          // Send to backend
          onCarModeAutoSend(finalText);
          currentTranscriptRef.current = "";
          
          // SENDING → THINKING (waiting for assistant response)
          transitionTo("THINKING", "message sent");
          
          // Start watchdog timer for stuck THINKING state (90s)
          thinkingWatchdogRef.current = setTimeout(() => {
            if (carModeStateRef.current === "THINKING") {
              console.warn("[Car Mode FSM] Watchdog: THINKING timeout, restarting");
              clearAllTimers();
              transitionTo("IDLE", "watchdog timeout");
              startRecognition();
            }
          }, THINKING_WATCHDOG_MS);
          
          // Stop recognition to clear buffer
          try {
            shouldAutoRestartRef.current = true; // Allow restart via onend
            rec.stop();
          } catch (err) {
            console.error("[Car Mode] Error stopping recognition after send:", err);
          }
        }
      }, SILENCE_TIMEOUT_MS);
    };
    
    // ────────── onstart: Recognition started ──────────
    rec.onstart = () => {
      setIsListening(true);
      if (isCarModeRef.current && carModeStateRef.current === "IDLE") {
        transitionTo("LISTENING", "recognition started");
      }
      console.log("[Car Mode] Recognition onstart");
    };
    
    // ────────── onend: Recognition stopped ──────────
    rec.onend = () => {
      setIsListening(false);
      console.log(`[Car Mode] Recognition onend | shouldAutoRestart: ${shouldAutoRestartRef.current} | state: ${carModeStateRef.current}`);
      
      // Only auto-restart if:
      // 1. We're in car mode
      // 2. Auto-restart is enabled (not explicitly stopped by user)
      // 3. We're in a state that expects listening (IDLE, LISTENING, TRANSCRIBING)
      if (
        isCarModeRef.current && 
        shouldAutoRestartRef.current &&
        (carModeStateRef.current === "IDLE" || 
         carModeStateRef.current === "LISTENING" || 
         carModeStateRef.current === "TRANSCRIBING")
      ) {
        try {
          rec.start();
          setIsListening(true);
          console.log("[Car Mode] Auto-restarted recognition");
        } catch (e: any) {
          if (!e.message?.includes("already started")) {
            console.error("[Car Mode] Failed to auto-restart:", e);
            transitionTo("IDLE", "restart failed");
          }
        }
      }
    };
    
    // ────────── onerror: Handle errors ──────────
    rec.onerror = (e: any) => {
      console.error("[Car Mode] Recognition error:", e.error);
      
      // Ignore no-speech and aborted errors (normal)
      if (e.error === "no-speech" || e.error === "aborted") {
        return;
      }
      
      // For other errors, reset to IDLE
      setIsListening(false);
      if (isCarModeRef.current) {
        clearAllTimers();
        transitionTo("IDLE", `error: ${e.error}`);
      }
    };

    return () => {
      console.log("[useVoice] Cleaning up recognition");
      rec.onend = null; // Prevent auto-restart during cleanup
      rec.onresult = null;
      rec.onstart = null;
      rec.onerror = null;
      
      try {
        rec.stop();
      } catch (e) {
        // Ignore cleanup errors
      }
      
      clearAllTimers();
    };
  }, [onResult, onCarModeAutoSend, transitionTo, clearAllTimers, startRecognition]);

  // ──────────────────────────────────────────────
  // Manual listening controls (normal mode)
  // ──────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening && !isCarMode) {
      try {
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        shouldAutoRestartRef.current = false;
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("[useVoice] Failed to start listening:", e);
      }
    }
  }, [isListening, isCarMode]);

  const stopListening = useCallback(() => {
    stopRecognition();
    clearAllTimers();
    currentTranscriptRef.current = "";
  }, [stopRecognition, clearAllTimers]);

  // ──────────────────────────────────────────────
  // Car Mode controls
  // ──────────────────────────────────────────────
  const startCarMode = useCallback(() => {
    console.log("[Car Mode] Starting Car Mode");
    isCarModeRef.current = true;
    setIsCarMode(true);
    clearAllTimers();
    transitionTo("IDLE", "car mode started");
    currentTranscriptRef.current = "";
    
    // Configure recognition for car mode
    if (recognitionRef.current) {
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      shouldAutoRestartRef.current = true;
      
      // Start listening
      startRecognition();
    }
  }, [transitionTo, clearAllTimers, startRecognition]);

  const stopCarMode = useCallback(() => {
    console.log("[Car Mode] Stopping Car Mode");
    
    // Stop audio if playing
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current = null;
      } catch (e) {
        console.error("[Car Mode] Error stopping audio:", e);
      }
    }
    
    // Clean stop of recognition
    isCarModeRef.current = false;
    setIsCarMode(false);
    shouldAutoRestartRef.current = false; // CRITICAL: Prevent auto-restart
    
    stopRecognition();
    clearAllTimers();
    
    transitionTo("IDLE", "car mode stopped");
    currentTranscriptRef.current = "";
    setIsSpeaking(false);
    
    // Reset recognition to normal mode settings
    if (recognitionRef.current) {
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
    }
  }, [transitionTo, clearAllTimers, stopRecognition]);

  // ──────────────────────────────────────────────
  // Text‑to‑speech via OpenAI TTS endpoint
  // ──────────────────────────────────────────────
  const speak = useCallback(async (text: string) => {
    try {
      console.log(`[Car Mode TTS] Speaking: "${text.slice(0, 50)}..."`);
      
      // Clear watchdog timer when speak is called
      clearAllTimers();
      
      // THINKING → SPEAKING (when assistant reply is ready to be spoken)
      if (carModeStateRef.current === "THINKING") {
        transitionTo("SPEAKING", "TTS started");
      }
      
      setIsSpeaking(true);
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "alloy" }),
      });
      
      if (!r.ok) throw new Error(`TTS failed: ${r.status}`);
      
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      
      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setIsSpeaking(false);
        console.log("[Car Mode TTS] Playback ended");
        
        // SPEAKING → IDLE → LISTENING (restart cycle)
        if (isCarModeRef.current && carModeStateRef.current === "SPEAKING") {
          transitionTo("IDLE", "TTS completed");
          // CRITICAL: Restart recognition to continue the conversation loop
          if (recognitionRef.current) {
            try {
              shouldAutoRestartRef.current = true;
              recognitionRef.current.start();
              setIsListening(true);
              console.log("[Car Mode] Restarted recognition after TTS");
            } catch (e: any) {
              if (!e.message?.includes("already started")) {
                console.error("[Car Mode] Failed to restart after TTS:", e);
              }
            }
          }
        }
      };
      
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setIsSpeaking(false);
        console.error("[Car Mode TTS] Playback error");
        
        // Error recovery: return to IDLE and restart recognition
        if (isCarModeRef.current) {
          transitionTo("IDLE", "TTS error");
          if (recognitionRef.current) {
            try {
              shouldAutoRestartRef.current = true;
              recognitionRef.current.start();
              setIsListening(true);
              console.log("[Car Mode] Restarted recognition after TTS error");
            } catch (e: any) {
              if (!e.message?.includes("already started")) {
                console.error("[Car Mode] Failed to restart after TTS error:", e);
              }
            }
          }
        }
      };
      
      await audio.play();
    } catch (err) {
      console.error("[Car Mode TTS] Error:", err);
      setIsSpeaking(false);
      audioRef.current = null;
      
      // Error recovery: return to IDLE and restart recognition
      if (isCarModeRef.current) {
        transitionTo("IDLE", "TTS exception");
        if (recognitionRef.current) {
          try {
            shouldAutoRestartRef.current = true;
            recognitionRef.current.start();
            setIsListening(true);
            console.log("[Car Mode] Restarted recognition after TTS exception");
          } catch (e: any) {
            if (!e.message?.includes("already started")) {
              console.error("[Car Mode] Failed to restart after TTS exception:", e);
            }
          }
        }
      }
    }
  }, [transitionTo, clearAllTimers]);

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
