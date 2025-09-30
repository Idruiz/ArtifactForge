import { useState, useCallback, useEffect } from "react";

interface UseVoiceReturn {
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  isSpeaking: boolean;
}

export function useVoice(onResult: (text: string) => void): UseVoiceReturn {
  // ──────────────────────────────────────────────
  // Speech‑to‑text (browser Web Speech API)
  // ──────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(
    null,
  );

  useEffect(() => {
    const SR: any =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    setIsSupported(true);
    const rec: SpeechRecognition = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;

    rec.onresult = (e) => {
      onResult(e.results[0][0].transcript);
      setIsListening(false);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);

    setRecognition(rec);
  }, [onResult]);

  const startListening = useCallback(() => {
    if (recognition && !isListening) {
      recognition.start();
      setIsListening(true);
    }
  }, [recognition, isListening]);

  const stopListening = useCallback(() => {
    recognition?.stop();
    setIsListening(false);
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
  };
}
