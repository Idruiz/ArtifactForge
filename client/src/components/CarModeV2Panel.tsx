import { useEffect, useRef, useState } from "react";

type Props = {
  userId: string;
  tz?: string;
};

const MAX_SESSION_SEC = 60 * 5; // same as server default 5 min

export default function CarModeV2Panel({ userId, tz = "America/Los_Angeles" }: Props) {
  const [listening, setListening] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [sessionSec, setSessionSec] = useState(0);

  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const vadActiveRef = useRef(false);
  const vadSilenceMs = 800; // stop after 800ms of silence
  const vadTimerRef = useRef<number | null>(null);
  const meterRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // simple regex for calendar intents
  const CALENDAR_VERBS = /(create|schedule|book|find).*(meeting|event|slot)/i;

  useEffect(() => {
    let t: any;
    if (listening) {
      t = setInterval(() => setSessionSec(s => s + 1), 1000);
    } else {
      setSessionSec(0);
    }
    return () => clearInterval(t);
  }, [listening]);

  async function start() {
    if (listening) return;
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      mediaRef.current = ms;

      // recorder
      const rec = new MediaRecorder(ms, { mimeType: "audio/webm;codecs=opus", bitsPerSecond: 32_000 });
      recRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => { await flushChunk(); };

      // VAD
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(ms);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      meterRef.current = proc;
      src.connect(proc);
      proc.connect(ctx.destination);

      proc.onaudioprocess = (ev) => {
        const data = ev.inputBuffer.getChannelData(0);
        let sum = 0; let zc = 0;
        for (let i = 0; i < data.length; i++) {
          sum += Math.abs(data[i]);
          if (i && (data[i] > 0) !== (data[i - 1] > 0)) zc++;
        }
        const energy = sum / data.length;
        // crude VAD thresholds
        const speaking = energy > 0.02 && zc > 20;

        if (speaking && !vadActiveRef.current) {
          // start recording
          vadActiveRef.current = true;
          chunksRef.current = [];
          rec.start();
          logLine("🎙️ voice detected — recording…");
          if (vadTimerRef.current) { window.clearTimeout(vadTimerRef.current); vadTimerRef.current = null; }
        } else if (!speaking && vadActiveRef.current) {
          // schedule stop after silenceMs
          if (!vadTimerRef.current) {
            vadTimerRef.current = window.setTimeout(() => {
              vadActiveRef.current = false;
              try { rec.stop(); } catch {}
              logLine("🛑 silence — sending chunk");
              vadTimerRef.current = null;
            }, vadSilenceMs) as any;
          }
        }
      };

      setListening(true);
      logLine("Car Mode V2 listening…");
    } catch (e: any) {
      logLine("mic error: " + e.message);
    }
  }

  async function stop() {
    setListening(false);
    if (meterRef.current) { meterRef.current.disconnect(); meterRef.current = null; }
    if (audioCtxRef.current) { try { await audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    if (recRef.current && recRef.current.state !== "inactive") { try { recRef.current.stop(); } catch {} }
    if (mediaRef.current) { mediaRef.current.getTracks().forEach(t => t.stop()); mediaRef.current = null; }
    logLine("Car Mode V2 stopped.");
  }

  async function flushChunk() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    if (blob.size < 2000) { return; } // too tiny
    if (!listening) return;

    // POST to STT
    const fd = new FormData();
    fd.append("audio", blob, "chunk.webm");
    fd.append("sessionSeconds", String(sessionSec));

    try {
      const r = await fetch("/car-v2/stt", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) { logLine("stt fail: " + (data.error || r.status)); return; }
      const text = (data.text || "").trim();
      if (!text) { logLine("…(silence)"); return; }

      logLine("you: " + text);

      // if it looks like a calendar command, auto route it
      if (CALENDAR_VERBS.test(text)) {
        const cmdRes = await fetch("/calendar-multi/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, text, tz, workHours: { start: "09:00", end: "18:00" } })
        });
        const j = await cmdRes.json();
        if (cmdRes.ok && j.eventId) {
          speak(`Booked. Starts at ${new Date(j.start).toLocaleTimeString()}.`);
          logLine(`✅ booked: ${j.htmlLink}`);
        } else if (cmdRes.ok && j.intent === "find_free") {
          speak("No time given. I'll look for a free slot.");
          logLine("suggestion: " + JSON.stringify(j.request));
        } else {
          logLine("command error: " + (j.error || "unknown"));
        }
      } else {
        // still speak back so you know it heard you
        speak(text);
      }
    } catch (e: any) {
      logLine("stt error: " + e.message);
    }
  }

  function speak(msg: string) {
    try {
      const u = new SpeechSynthesisUtterance(msg);
      window.speechSynthesis.speak(u);
    } catch {}
  }

  function logLine(s: string) { setLog(prev => [s, ...prev].slice(0, 100)); }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <button
          className={`px-4 py-2 rounded ${listening ? "bg-red-600" : "bg-green-600"} text-white`}
          onClick={listening ? stop : start}
          data-testid={listening ? "button-stop-carv2" : "button-start-carv2"}
        >
          {listening ? "Stop (Car Mode V2)" : "Start (Car Mode V2)"}
        </button>
        <div className="text-sm opacity-70">session: {Math.floor(sessionSec/60)}m {sessionSec%60}s</div>
      </div>
      <div className="text-xs font-mono leading-5 max-h-48 overflow-auto border p-2 rounded bg-black text-green-300">
        {log.map((l,i)=><div key={i}>{l}</div>)}
      </div>
      <p className="text-xs opacity-70">
        Tip: say "create a team meeting today at 12:30 with &quot;colleague calendar&quot; for 30 minutes".
      </p>
    </div>
  );
}
