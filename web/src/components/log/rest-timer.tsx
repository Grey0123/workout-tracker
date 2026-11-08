"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { adjust, clock, readRest, REST_CHOICES, restLabel, secondsLeft } from "@/lib/log/timer";

type Rest = {
  /** Seconds the timer runs for. */
  seconds: number;
  /** Whether saving an exercise starts it. */
  auto: boolean;
  setSeconds: (seconds: number) => void;
  setAuto: (auto: boolean) => void;
  start: () => void;
  /** Starts it when auto-start is on: after an exercise is logged (PRD 5.5). */
  afterSet: () => void;
};

const RestContext = createContext<Rest | null>(null);

export function useRest(): Rest {
  const rest = useContext(RestContext);
  if (!rest) throw new Error("useRest needs a RestTimerProvider.");
  return rest;
}

// Preferences for this device only. Storage can be missing or blocked, so every use is guarded.
const KEY_SECONDS = "wt-rest-seconds";
const KEY_AUTO = "wt-rest-auto";
const read = (key: string) => {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/** A short beep. The audio is unlocked by the tap that started the timer. */
function beeper() {
  let ctx: AudioContext | null = null;
  return {
    unlock() {
      try {
        ctx ??= new AudioContext();
        if (ctx.state === "suspended") ctx.resume();
      } catch {}
    },
    beep() {
      if (!ctx) return;
      try {
        for (const at of [0, 0.25]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.2, ctx.currentTime + at);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.18);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + at);
          osc.stop(ctx.currentTime + at + 0.2);
        }
      } catch {}
    },
  };
}

export function RestTimerProvider({ children }: { children: ReactNode }) {
  // Only the settings read these, and they render once the log has loaded in the browser.
  const [seconds, setSecondsState] = useState(() => readRest(read(KEY_SECONDS)));
  const [auto, setAutoState] = useState(() => read(KEY_AUTO) !== "off");
  const [endsAt, setEndsAt] = useState<number | null>(null);
  // Set when the timer starts: nothing reads it before then, and pages are prerendered without a clock.
  const [now, setNow] = useState(0);
  const [over, setOver] = useState(false);
  const [sound] = useState(beeper);
  const rang = useRef(false);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [endsAt]);

  const left = endsAt === null ? 0 : secondsLeft(endsAt, now);
  const running = endsAt !== null && left > 0;

  // Rest over: buzz and beep once, then show "Go" for a few seconds.
  useEffect(() => {
    if (endsAt === null || left > 0 || rang.current) return;
    rang.current = true;
    setOver(true);
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {}
    sound.beep();
    const hide = setTimeout(() => {
      setOver(false);
      setEndsAt(null);
    }, 6000);
    return () => clearTimeout(hide);
  }, [endsAt, left, sound]);

  // Toasts move up while the timer is on screen.
  const visible = running || over;
  useEffect(() => {
    document.documentElement.toggleAttribute("data-rest", visible);
  }, [visible]);

  const start = useCallback(() => {
    sound.unlock();
    rang.current = false;
    setOver(false);
    const end = Date.now() + seconds * 1000;
    setNow(Date.now());
    setEndsAt(end);
  }, [seconds, sound]);

  const stop = () => {
    setEndsAt(null);
    setOver(false);
  };

  const move = (by: number) => {
    if (endsAt === null) return;
    const end = adjust(endsAt, Date.now(), by);
    setEndsAt(end);
    setNow(Date.now());
  };

  const value = useMemo<Rest>(
    () => ({
      seconds,
      auto,
      setSeconds: (s) => {
        setSecondsState(s);
        write(KEY_SECONDS, String(s));
      },
      setAuto: (a) => {
        setAutoState(a);
        write(KEY_AUTO, a ? "on" : "off");
      },
      start,
      afterSet: () => {
        if (auto) start();
      },
    }),
    [seconds, auto, start],
  );

  return (
    <RestContext.Provider value={value}>
      {children}
      {visible && (
        <div className={`rest-timer${over ? " over" : ""}`} role="timer" aria-live={over ? "assertive" : "off"} aria-label="Rest timer">
          {over ? (
            <span className="rest-go">Rest over. Next set!</span>
          ) : (
            <>
              <button type="button" className="rest-adj" aria-label="15 seconds less" onClick={() => move(-15)}>
                −15
              </button>
              <span className="rest-time">
                <small>Rest</small>
                {clock(left)}
              </span>
              <button type="button" className="rest-adj" aria-label="15 seconds more" onClick={() => move(15)}>
                +15
              </button>
            </>
          )}
          <button type="button" className="rest-x" aria-label={over ? "Close" : "Skip rest"} onClick={stop}>
            ×
          </button>
        </div>
      )}
    </RestContext.Provider>
  );
}

/** Under the log form on your own log today: how long to rest, and whether it starts by itself. */
export function RestSettings() {
  const { seconds, auto, setSeconds, setAuto, start } = useRest();
  return (
    <div className="rest-settings" role="group" aria-label="Rest timer">
      <span className="field-label">Rest timer</span>
      <div className="rest-chips">
        <button type="button" className={!auto ? "active" : ""} aria-pressed={!auto} onClick={() => setAuto(false)}>
          Off
        </button>
        {REST_CHOICES.map((s) => (
          <button
            key={s}
            type="button"
            className={auto && seconds === s ? "active" : ""}
            aria-pressed={auto && seconds === s}
            onClick={() => {
              setSeconds(s);
              setAuto(true);
            }}
          >
            {restLabel(s)}
          </button>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={start}>
        Start {restLabel(seconds)} now
      </button>
      <div className="cx-hint">{auto ? "Starts by itself when you save an exercise." : "Won't start by itself."}</div>
    </div>
  );
}
