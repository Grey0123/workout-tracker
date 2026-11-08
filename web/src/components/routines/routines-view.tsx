"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { CustomExerciseForm } from "@/components/log/custom-exercise-form";
import { ExercisePicker, findByName } from "@/components/log/exercise-picker";
import { useLog } from "@/components/log/log-provider";
import { dayMonth, todayKey } from "@/lib/log/dates";
import { cleanName, newId, plural, TEMPO } from "@/lib/log/sets";
import type { Exercise } from "@/lib/log/types";
import * as api from "@/lib/routines/api";
import { REPS, targetLabel, type Plan, type Routine, type RoutineItem } from "@/lib/routines/plan";

type DraftItem = {
  key: string;
  exerciseId: string | null;
  query: string;
  variant: string;
  sets: string;
  reps: string;
  tempo: string;
  notes: string;
  invalid: boolean;
};

const blankItem = (): DraftItem => ({ key: newId(), exerciseId: null, query: "", variant: "", sets: "3", reps: "", tempo: "", notes: "", invalid: false });

const draftItem = (item: RoutineItem, exercises: Exercise[]): DraftItem => ({
  key: newId(),
  exerciseId: item.exercise_id,
  query: exercises.find((e) => e.id === item.exercise_id)?.name ?? "",
  variant: item.variant ?? "",
  sets: item.target_sets ? String(item.target_sets) : "",
  reps: item.target_reps ?? "",
  tempo: item.target_tempo ?? "",
  notes: item.notes ?? "",
  invalid: false,
});

/** Creates a routine, or edits one when given it. */
function RoutineEditor({ routine, onClose }: { routine: Routine | null; onClose: () => void }) {
  const { exercises, me, update, toast } = useLog();
  // A routine holds built-in exercises and my own custom ones (the database says the same).
  const pool = useMemo(() => exercises.filter((e) => !e.is_custom || e.created_by === me.id), [exercises, me.id]);
  const [name, setName] = useState(routine?.name ?? "");
  const [notes, setNotes] = useState(routine?.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(() => (routine ? routine.items.map((i) => draftItem(i, exercises)) : [blankItem()]));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<{ key: string; name: string } | null>(null);

  const change = (key: string, patch: Partial<DraftItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const move = (index: number, by: number) =>
    setItems((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const clean = cleanName(name);
    if (!clean) return setError("Give the routine a name.");
    const out: RoutineItem[] = [];
    let bad = false;
    const checked = items.map((item, n) => {
      const exercise = pool.find((e) => e.id === item.exerciseId && e.name.toLowerCase() === cleanName(item.query).toLowerCase()) ?? findByName(pool, item.query);
      if (!exercise) {
        bad = true;
        return { ...item, invalid: true };
      }
      const sets = item.sets.trim() ? Number(item.sets) : null;
      const reps = item.reps.trim().replace(/\s*[–—]\s*|\s+to\s+/g, "-");
      const tempo = item.tempo.trim().toUpperCase();
      if (sets !== null && !(Number.isInteger(sets) && sets >= 1 && sets <= 20)) setError(`Exercise ${n + 1}: sets go from 1 to 20.`);
      else if (reps && !REPS.test(reps)) setError(`Exercise ${n + 1}: write reps like 8 or 8-10.`);
      else if (tempo && !TEMPO.test(tempo)) setError(`Exercise ${n + 1}: write the tempo like 3-1-1-0.`);
      else {
        out.push({
          exercise_id: exercise.id,
          variant: item.variant.trim() || null,
          target_sets: sets,
          target_reps: reps || null,
          target_tempo: tempo || null,
          notes: item.notes.trim() || null,
        });
        return { ...item, exerciseId: exercise.id, query: exercise.name, invalid: false };
      }
      bad = true;
      return item;
    });
    setItems(checked);
    if (bad) {
      setError((e) => e || "Pick an exercise from the list for each row, or remove the row.");
      return;
    }
    if (!out.length) return setError("Add at least one exercise.");

    setBusy(true);
    try {
      const id = await api.saveRoutine(routine?.id ?? null, clean, notes.trim() || null, out);
      const saved: Routine = { id, name: clean, notes: notes.trim() || null, updated_at: new Date().toISOString(), items: out };
      update((d) => ({ ...d, routines: [...d.routines.filter((r) => r.id !== id), saved].sort((a, b) => a.name.localeCompare(b.name)) }));
      toast(`Saved ${clean}`);
      onClose();
    } catch (err) {
      console.error(err);
      setError(api.routineError(err));
    }
    setBusy(false);
  }

  return (
    <form className="card routine-editor" onSubmit={save} noValidate>
      <div className="form-title">{routine ? `Edit ${routine.name}` : "New routine"}</div>
      <div className="ffield">
        <label htmlFor="r-name">Name</label>
        <input id="r-name" value={name} maxLength={60} placeholder="Push Day" autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="ffield">
        <label htmlFor="r-notes">
          Notes <span className="opt">(optional)</span>
        </label>
        <textarea id="r-notes" value={notes} maxLength={500} placeholder="Warm up first, rest 2 minutes between sets…" onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="field-label">Exercises</div>
      <ol className="routine-items">
        {items.map((item, i) => (
          <li key={item.key} className="routine-item">
            <div className="ri-top">
              <span className="pi-n">{i + 1}</span>
              <div className="ri-picker">
                <ExercisePicker
                  id={`ri-${item.key}`}
                  query={item.query}
                  selected={pool.find((e) => e.id === item.exerciseId)}
                  invalid={item.invalid}
                  pool={pool}
                  onQuery={(query) => change(item.key, { query })}
                  onSelect={(e) => change(item.key, { exerciseId: e.id, query: e.name, invalid: false })}
                  onCustom={(typed) => setCustom({ key: item.key, name: typed })}
                />
              </div>
              <div className="ri-tools">
                <button type="button" aria-label={`Move exercise ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" aria-label={`Move exercise ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove exercise ${i + 1}`}
                  onClick={() => setItems((list) => (list.length > 1 ? list.filter((x) => x.key !== item.key) : [blankItem()]))}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="ri-targets">
              <label>
                <span>Sets</span>
                <input inputMode="numeric" value={item.sets} maxLength={2} placeholder="3" aria-label={`Exercise ${i + 1} sets`} onChange={(e) => change(item.key, { sets: e.target.value })} />
              </label>
              <label>
                <span>Reps</span>
                <input value={item.reps} maxLength={7} placeholder="8-10" aria-label={`Exercise ${i + 1} reps`} onChange={(e) => change(item.key, { reps: e.target.value })} />
              </label>
              <label>
                <span>Tempo</span>
                <input value={item.tempo} maxLength={7} placeholder="3-1-1-0" aria-label={`Exercise ${i + 1} tempo`} onChange={(e) => change(item.key, { tempo: e.target.value })} />
              </label>
              <label>
                <span>Variant</span>
                <input value={item.variant} maxLength={100} placeholder="Optional" aria-label={`Exercise ${i + 1} variant`} onChange={(e) => change(item.key, { variant: e.target.value })} />
              </label>
            </div>
            <input
              className="ri-note"
              value={item.notes}
              maxLength={300}
              placeholder="Note for this exercise (optional)"
              aria-label={`Exercise ${i + 1} note`}
              onChange={(e) => change(item.key, { notes: e.target.value })}
            />
          </li>
        ))}
      </ol>
      <button type="button" className="sb-add" disabled={items.length >= 40} onClick={() => setItems((list) => [...list, blankItem()])}>
        + Add exercise
      </button>
      <div className="sb-hint">Reps can be a range, like 8-10. Starting the routine fills in last session&apos;s weights.</div>

      <div className="card-actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Saving…" : "Save routine"}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="status err" role="status">
        {error}
      </div>

      {custom && (
        <CustomExerciseForm
          initialName={custom.name}
          onUse={(chosen) => {
            change(custom.key, { exerciseId: chosen.id, query: chosen.name, invalid: false });
            setCustom(null);
          }}
          onSaved={(saved) => {
            change(custom.key, { exerciseId: saved.id, query: saved.name, invalid: false });
            setCustom(null);
          }}
          onClose={() => setCustom(null)}
        />
      )}
    </form>
  );
}

/** One routine: what's in it, and starting it on a day. */
function RoutineCard({ routine, onEdit }: { routine: Routine; onEdit: () => void }) {
  const { exercises, profile, me, plansByDate, update, toast, openDay } = useLog();
  const router = useRouter();
  const [day, setDay] = useState(todayKey());
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const coach = profile.account_type === "coach";

  /** True once the routine is on that day. */
  async function plan(date: string): Promise<boolean> {
    const existing = plansByDate.get(date);
    if (existing?.template_id === routine.id) return true;
    const replace = !!existing;
    if (existing && !confirm(`${dayMonth(date)} already has ${existing.name}. Replace it with ${routine.name}?`)) return false;
    setBusy(true);
    try {
      const id = await api.planRoutine(routine.id, me.id, date, replace);
      const added: Plan = {
        id, date, name: routine.name, notes: routine.notes, template_id: routine.id, assigned_by: me.id, skipped_at: null, items: routine.items,
      };
      update((d) => ({ ...d, plans: [...d.plans.filter((p) => p.date !== date), added] }));
      toast(`${routine.name} is on ${dayMonth(date)}`);
      setPicking(false);
      setBusy(false);
      return true;
    } catch (err) {
      console.error(err);
      toast(api.routineError(err), "err");
    }
    setBusy(false);
    return false;
  }

  async function startToday() {
    const today = todayKey();
    if (await plan(today)) {
      openDay(today, "workout");
      router.push("/calendar");
    }
  }

  async function remove() {
    if (!confirm(`Delete the routine ${routine.name}? Days it's already planned on keep it.`)) return;
    try {
      await api.deleteRoutine(routine.id);
      update((d) => ({ ...d, routines: d.routines.filter((r) => r.id !== routine.id) }));
      toast(`Deleted ${routine.name}`);
    } catch (err) {
      console.error(err);
      toast(api.routineError(err), "err");
    }
  }

  return (
    <section className="card routine-card" aria-label={routine.name}>
      <div className="plan-head">
        <div>
          <div className="plan-name">{routine.name}</div>
          <div className="cx-hint">{plural(routine.items.length, "exercise")}</div>
        </div>
        <button type="button" className="link-btn" onClick={onEdit}>
          Edit
        </button>
      </div>
      {routine.notes && <div className="plan-notes">{routine.notes}</div>}
      <ol className="plan-items compact">
        {routine.items.map((item, i) => (
          <li key={`${item.exercise_id}-${i}`}>
            <span className="pi-n">{i + 1}</span>
            <span className="pi-body">
              <span className="pi-name">
                {exercises.find((e) => e.id === item.exercise_id)?.name ?? "Exercise"}
                {item.variant && <span className="pi-variant"> · {item.variant}</span>}
              </span>
              {targetLabel(item) && <span className="pi-target">{targetLabel(item)}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="card-actions">
        {/* A coach trains too: their own days are planned here, clients' from their calendar. */}
        <button type="button" className="btn sm" disabled={busy} onClick={startToday}>
          Start today
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setPicking(!picking)}>
          Plan a day
        </button>
        <button type="button" className="link-btn danger" onClick={remove}>
          Delete
        </button>
      </div>
      {picking && (
        <div className="plan-day">
          <input type="date" aria-label={`Day for ${routine.name}`} value={day} onChange={(e) => setDay(e.target.value)} />
          <button type="button" className="btn sm" disabled={busy || !day} onClick={() => plan(day)}>
            Put on {day ? dayMonth(day) : "that day"}
          </button>
        </div>
      )}
      {coach && <div className="cx-hint">To plan this for a client, open their calendar from Clients.</div>}
    </section>
  );
}

export function RoutinesView() {
  const { routines, isOwn } = useLog();
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  if (!isOwn) return null;

  return (
    <>
      <div className="page-top">
        <h1 className="section page-heading">Routines</h1>
        {!editing && (
          <button type="button" className="btn sm" onClick={() => setEditing("new")}>
            New routine
          </button>
        )}
      </div>
      <p className="page-intro">
        Save the workouts you repeat, like Push Day. Starting one fills in each exercise with last session&apos;s weights, so logging is a few taps.
      </p>
      {editing && <RoutineEditor key={editing === "new" ? "new" : editing.id} routine={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <div className="routine-list">
        {routines.map((r) => (
          <RoutineCard key={r.id} routine={r} onEdit={() => setEditing(r)} />
        ))}
      </div>
      {!routines.length && !editing && (
        <div className="card no-entries">
          No routines yet. Make one here, or open a day you trained in the calendar and save it as a routine.
        </div>
      )}
    </>
  );
}
