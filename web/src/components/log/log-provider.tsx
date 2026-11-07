"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "@/lib/log/api";
import { shiftMonth, todayKey } from "@/lib/log/dates";
import { mealHasContent, newId } from "@/lib/log/sets";
import type { Entry, Exercise, Meal, MealSlot, Profile } from "@/lib/log/types";
import type { Connection } from "@/lib/people/types";
import { supabaseEnv } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";

export type Pane = "workout" | "food";
type Toast = { id: number; message: string; kind: "ok" | "err"; leaving?: boolean };

export type MealInput = {
  date: string;
  slot: MealSlot;
  description: string | null;
  notes: string | null;
  /** A new photo to upload. */
  photo: Blob | null;
  photoPreview: string | null;
  /** The saved photo to keep, or null to remove it. */
  keepPhotoPath: string | null;
};

type Log = {
  /** Whose log is shown. */
  profile: Profile;
  /** Who is looking: the same person unless someone shared their log with them. */
  me: Profile;
  /** How the log was shared with me, or null when it's my own. */
  connection: Connection | null;
  /** Someone else's log can only be looked at, for now. */
  readOnly: boolean;
  /** Where this log's screens live: "" for my own, "/u/name" for a shared one. */
  basePath: string;
  shares: { workouts: boolean; meals: boolean; mealPhotos: boolean };
  people: api.PeopleCounts;
  exercises: Exercise[];
  entries: Entry[];
  meals: Meal[];
  byDate: Map<string, Entry[]>;
  mealsByDate: Map<string, Partial<Record<MealSlot, Meal>>>;
  trainedDays: string[];
  /** Exercises whose weight is assistance, which volume leaves out. */
  assistedIds: ReadonlySet<string>;

  selectedDay: string;
  month: string;
  pane: Pane;
  selectDay: (day: string) => void;
  showMonth: (months: number) => void;
  showToday: () => void;
  openDay: (day: string, pane?: Pane) => void;
  setPane: (pane: Pane) => void;
  /** Set when a Log button on Home wants the form brought into view on arrival. */
  focusForm: boolean;
  clearFocusForm: () => void;

  saveEntry: (entry: Entry, label: string) => Promise<boolean>;
  deleteEntry: (entry: Entry, label: string) => Promise<void>;
  saveMeal: (input: MealInput) => Promise<boolean>;
  deleteMeal: (meal: Meal) => Promise<void>;
  saveExercise: (id: string | null, input: api.ExerciseInput) => Promise<Exercise>;
  toast: (message: string, kind?: Toast["kind"]) => void;
};

const LogContext = createContext<Log | null>(null);

export function useLog(): Log {
  const log = useContext(LogContext);
  if (!log) throw new Error("useLog needs a LogProvider.");
  return log;
}

let toastSeq = 0;

/** Writes run one at a time, in the order they were made, so a slow save can't land after the edit that followed it. */
function writeQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(write: () => Promise<T>): Promise<T> => {
    const run = tail.then(write, write);
    tail = run.catch(() => {});
    return run;
  };
}

/** Without a username, the signed-in person's own log. With one, the log they share with you. */
export function LogProvider({ username, children }: { username?: string; children: ReactNode }) {
  const [data, setData] = useState<api.LogData | null>(null);
  const [failed, setFailed] = useState("");
  const [notShared, setNotShared] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selectedDay, setSelectedDay] = useState("");
  const [month, setMonth] = useState("");
  const [pane, setPane] = useState<Pane>("workout");
  const [focusForm, setFocusForm] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [enqueue] = useState(writeQueue);

  const configured = !!supabaseEnv();

  useEffect(() => {
    if (!configured) return;
    let live = true;
    api.loadLog(username).then(
      (loaded) => {
        if (!live) return;
        setData(loaded);
        // "Today" is the visitor's today, which only the browser knows.
        const today = todayKey();
        setSelectedDay((day) => day || today);
        setMonth((m) => m || today);
      },
      (err: Error) => {
        if (!live) return;
        if (err instanceof api.NotShared) return setNotShared(err.message);
        console.error(err);
        setFailed(`Couldn't load ${username ? "this" : "your"} log. Check your connection and try again.`);
      },
    );
    return () => {
      live = false;
    };
  }, [configured, attempt, username]);

  const toast = useCallback((message: string, kind: Toast["kind"] = "ok") => {
    const id = ++toastSeq;
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 3200);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3420);
  }, []);

  const setEntries = useCallback((change: (entries: Entry[]) => Entry[]) => {
    setData((d) => (d ? { ...d, entries: change(d.entries) } : d));
  }, []);
  const setMeals = useCallback((change: (meals: Meal[]) => Meal[]) => {
    setData((d) => (d ? { ...d, meals: change(d.meals) } : d));
  }, []);

  const userId = data?.profile.id ?? "";

  const saveEntry = useCallback(
    async (entry: Entry, label: string) => {
      const previous = data?.entries.find((e) => e.id === entry.id);
      const shown = { ...entry, saving: true };
      setEntries((entries) => (previous ? entries.map((e) => (e.id === entry.id ? shown : e)) : [...entries, shown]));
      try {
        await enqueue(() => api.saveEntry(userId, entry));
        setEntries((entries) => entries.map((e) => (e.id === entry.id ? entry : e)));
        toast(`${previous ? "Updated" : "Saved"}: ${label}`);
        return true;
      } catch (err) {
        console.error(err);
        setEntries((entries) =>
          previous ? entries.map((e) => (e.id === entry.id ? previous : e)) : entries.filter((e) => e.id !== entry.id),
        );
        toast("Save failed. Check your connection.", "err");
        return false;
      }
    },
    [data, enqueue, setEntries, toast, userId],
  );

  const deleteEntry = useCallback(
    async (entry: Entry, label: string) => {
      setEntries((entries) => entries.filter((e) => e.id !== entry.id));
      try {
        await enqueue(() => api.deleteEntry(entry.id));
        toast("Deleted");
      } catch (err) {
        console.error(err);
        setEntries((entries) => [...entries, entry]);
        toast(`Couldn't delete ${label}. Check your connection.`, "err");
      }
    },
    [enqueue, setEntries, toast],
  );

  const saveMeal = useCallback(
    async (input: MealInput) => {
      const isSlot = (m: Meal) => m.date === input.date && m.slot === input.slot;
      const previous = data?.meals.find(isSlot);
      const shown: Meal = {
        id: previous?.id ?? newId(),
        date: input.date,
        slot: input.slot,
        description: input.description,
        notes: input.notes,
        photo_path: input.keepPhotoPath,
        photo_preview: input.photoPreview ?? undefined,
        saving: true,
      };
      setMeals((meals) => [...meals.filter((m) => !isSlot(m)), shown]);

      let uploaded: string | null = null;
      try {
        const id = await enqueue(async () => {
          if (input.photo) uploaded = await api.uploadPhoto(userId, input.photo);
          return api.saveMeal(userId, {
            date: input.date,
            slot: input.slot,
            description: input.description,
            notes: input.notes,
            photo_path: uploaded ?? input.keepPhotoPath,
          });
        });
        const photo_path = uploaded ?? input.keepPhotoPath;
        setMeals((meals) => meals.map((m) =>
          isSlot(m)
            ? { id, date: input.date, slot: input.slot, description: input.description, notes: input.notes, photo_path }
            : m,
        ));
        // Removing a photo should really remove it, not just unlink it.
        const old = previous?.photo_path;
        if (old && old !== photo_path) api.removePhoto(old).catch(console.error);
        toast(`Saved: ${input.slot} meal`);
        return true;
      } catch (err) {
        console.error(err);
        if (uploaded) api.removePhoto(uploaded).catch(console.error);
        setMeals((meals) => [...meals.filter((m) => !isSlot(m)), ...(previous ? [previous] : [])]);
        toast("Save failed. Check your connection.", "err");
        return false;
      }
    },
    [data, enqueue, setMeals, toast, userId],
  );

  const deleteMeal = useCallback(
    async (meal: Meal) => {
      setMeals((meals) => meals.filter((m) => m.id !== meal.id));
      try {
        await enqueue(() => api.deleteMeal(meal.id));
        toast(`Deleted ${meal.slot} meal`);
      } catch (err) {
        console.error(err);
        setMeals((meals) => [...meals, meal]);
        toast("Delete failed. Check your connection.", "err");
      }
    },
    [enqueue, setMeals, toast],
  );

  const saveExercise = useCallback(
    async (id: string | null, input: api.ExerciseInput) => {
      const saved = id ? await api.updateExercise(id, input) : await api.createExercise(userId, input);
      setData((d) => d && { ...d, exercises: [...d.exercises.filter((e) => e.id !== saved.id), saved] });
      return saved;
    },
    [userId],
  );

  const selectDay = useCallback((day: string) => {
    setSelectedDay(day);
    setMonth(day);
  }, []);
  const showMonth = useCallback((months: number) => setMonth((m) => shiftMonth(m, months)), []);
  const showToday = useCallback(() => selectDay(todayKey()), [selectDay]);
  const openDay = useCallback(
    (day: string, nextPane?: Pane) => {
      selectDay(day);
      if (nextPane) {
        setPane(nextPane);
        setFocusForm(true);
      }
    },
    [selectDay],
  );
  const clearFocusForm = useCallback(() => setFocusForm(false), []);

  const log = useMemo<Log | null>(() => {
    if (!data) return null;
    const byDate = new Map<string, Entry[]>();
    for (const entry of [...data.entries].sort((a, b) => a.position - b.position)) {
      byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
    }
    const mealsByDate = new Map<string, Partial<Record<MealSlot, Meal>>>();
    for (const meal of data.meals) {
      if (mealHasContent(meal)) mealsByDate.set(meal.date, { ...mealsByDate.get(meal.date), [meal.slot]: meal });
    }
    const c = data.connection;
    return {
      ...data,
      readOnly: !!c,
      basePath: c ? `/u/${data.profile.username}` : "",
      shares: { workouts: !c || c.share_workouts, meals: !c || c.share_meals, mealPhotos: !c || c.share_meal_photos },
      byDate,
      mealsByDate,
      trainedDays: [...byDate.keys()].sort(),
      assistedIds: new Set(data.exercises.filter((e) => e.assisted).map((e) => e.id)),
      selectedDay,
      month,
      pane,
      selectDay,
      showMonth,
      showToday,
      openDay,
      setPane,
      focusForm,
      clearFocusForm,
      saveEntry,
      deleteEntry,
      saveMeal,
      deleteMeal,
      saveExercise,
      toast,
    };
  }, [data, selectedDay, month, pane, focusForm, clearFocusForm, selectDay, showMonth, showToday, openDay, saveEntry, deleteEntry, saveMeal, deleteMeal, saveExercise, toast]);

  let body: ReactNode;
  if (!configured) body = <SetupNotice />;
  else if (notShared)
    body = (
      <div className="card loading">
        <p>{notShared} isn&apos;t sharing their log with you, or has stopped.</p>
        <Link href="/people" className="btn ghost" style={{ marginTop: 12 }}>
          Go to People
        </Link>
      </div>
    );
  else if (failed)
    body = (
      <div className="card loading">
        <p>{failed}</p>
        <button
          type="button"
          className="btn ghost"
          style={{ marginTop: 12 }}
          onClick={() => {
            setFailed("");
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  else if (!log) body = <div className="card loading">Loading…</div>;
  else body = <LogContext.Provider value={log}>{children}</LogContext.Provider>;

  return (
    <>
      {body}
      {toasts.length > 0 && (
        <div className="toast-wrap">
          {toasts.slice(-3).map((t) => (
            <div key={t.id} role="status" className={`toast ${t.kind}${t.leaving ? " leaving" : ""}`}>
              <span className="tick">{t.kind === "err" ? "!" : "✓"}</span>
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
