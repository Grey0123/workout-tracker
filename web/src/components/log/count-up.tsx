"use client";

import { useEffect, useRef, useState } from "react";

/** Ticks a figure from what it last showed to its new value, as v1's stats do. */
export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const start = current.current;
    if (start === value) return;

    let frame = 0;
    const show = (n: number) => {
      current.current = n;
      setShown(n);
    };
    const animate = (now: number, began: number) => {
      const p = Math.min(1, (now - began) / 520);
      show(start + (value - start) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame((t) => animate(t, began));
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    frame = requestAnimationFrame((t) => (reduced ? show(value) : animate(t, t)));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{format(shown)}</>;
}
