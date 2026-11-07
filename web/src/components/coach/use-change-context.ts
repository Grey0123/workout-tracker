"use client";

import { useMemo } from "react";
import { useLog } from "@/components/log/log-provider";
import type { ChangeContext } from "@/lib/coach/changes";

/** Names exercises and days for change descriptions, from the log on screen. */
export function useChangeContext(): ChangeContext {
  const { exercises, entries, isOwn } = useLog();
  return useMemo(() => {
    const names = new Map(exercises.map((e) => [e.id, e.name]));
    const byId = new Map(entries.map((e) => [e.id, e]));
    const days = new Map(entries.filter((e) => e.session_id).map((e) => [e.session_id!, e.date]));
    return {
      exerciseName: (id) => names.get(id),
      entry: (id) => {
        const e = byId.get(id);
        return e ? { exerciseId: e.exercise_id, date: e.date } : undefined;
      },
      sessionDate: (id) => days.get(id),
      whose: isOwn ? "your" : "their",
    };
  }, [exercises, entries, isOwn]);
}
