"use client";

import { useState, type FormEvent } from "react";
import { dayMonth } from "@/lib/log/dates";
import {
  cleanName,
  columnsFor,
  newId,
  readRows,
  setLabels,
  setToRow,
  TEMPO,
  timeUnit,
  variantSuggestions,
  type DraftRow,
} from "@/lib/log/sets";
import { COMMON_VARIANTS, METRICS, type Entry, type Exercise, type ExerciseKind, type Metric, type SetValues, type Side } from "@/lib/log/types";
import type { RoutineItem } from "@/lib/routines/plan";
import { CustomExerciseForm } from "./custom-exercise-form";
import { ExercisePicker, findByName, usePickableExercises } from "./exercise-picker";
import { useLog } from "./log-provider";

type Draft = {
  id: string | null;
  /** The id of a new entry whose save failed. Reusing it means a retry can't log it twice. */
  retryId: string | null;
  exerciseId: string | null;
  query: string;
  variant: string;
  notes: string;
  tempo: string;
  perSetTempo: boolean;
  rows: DraftRow[];
};

const row = (side: Side | null = null, values: DraftRow["values"] = {}): DraftRow => ({ key: newId(), side, tempo: "", values });

const blankRows = (perSide = false) =>
  Array.from({ length: 3 }, () => (perSide ? [row("left"), row("right")] : [row()])).flat();

const blankDraft = (): Draft => ({
  id: null,
  retryId: null,
  exerciseId: null,
  query: "",
  variant: "",
  notes: "",
  tempo: "",
  perSetTempo: false,
  rows: blankRows(),
});

function draftOf(entry: Entry, exercise: Exercise | undefined): Draft {
  const kind = exercise?.kind ?? "weighted";
  return {
    id: entry.id,
    retryId: null,
    exerciseId: entry.exercise_id,
    query: exercise?.name ?? "",
    variant: entry.variant ?? "",
    notes: entry.notes ?? "",
    tempo: entry.tempo ?? "",
    perSetTempo: entry.sets.some((s) => s.tempo),
    rows: entry.sets.map((set) => setToRow(set, kind, newId())),
  };
}

/** A planned exercise to log: the form opens with it and its pre-filled sets. */
export type PlanStart = { item: RoutineItem; sets: SetValues[] };

function draftOfPlan({ item, sets }: PlanStart, exercise: Exercise | undefined): Draft {
  const kind = exercise?.kind ?? "weighted";
  return {
    ...blankDraft(),
    exerciseId: item.exercise_id,
    query: exercise?.name ?? "",
    variant: item.variant ?? "",
    tempo: item.target_tempo ?? "",
    rows: sets.length ? sets.map((set) => setToRow(set, kind, newId())) : blankRows(exercise?.per_side),
  };
}

/** Picking another exercise keeps what's typed, in the shape the new one logs. */
function fitRows(rows: DraftRow[], perSide: boolean): DraftRow[] {
  const sided = rows.some((r) => r.side);
  if (perSide === sided) return rows;
  if (!perSide) return rows.map((r) => ({ ...r, side: null }));
  return rows.flatMap((r) => [{ ...r, side: "left" as const }, row("right", r.values)]);
}

const HINTS: Record<ExerciseKind, string> = {
  weighted: "Each set keeps its own weight, so a ramp-up like 60 / 65 / 70 kg is recorded exactly.",
  bodyweight: "Log the reps for each set. Add weight only if you wore some.",
  timed: "Enter each hold in seconds or m:ss, like a plank at 45 / 40 / 30.",
  cardio: "Enter the time in minutes or m:ss, and the distance if you know it.",
  session: "Enter how long it lasted, in minutes or m:ss.",
  custom: "Each set keeps its own numbers. Time is in seconds or m:ss.",
};

const ASSISTED_HINT = "Log how much the machine helps. Less help means you're getting stronger.";

const PLACEHOLDERS: Record<Metric, string> = {
  weight_kg: "kg",
  reps: "reps",
  duration_s: "sec",
  distance_km: "km",
  rounds: "rounds",
  rpe: "RPE",
  calories: "kcal",
};

const ARIA: Record<Metric, string> = {
  weight_kg: "weight in kg",
  reps: "reps",
  duration_s: "time",
  distance_km: "distance in km",
  rounds: "rounds",
  rpe: "effort, 1 to 10",
  calories: "calories",
};

const TEMPO_HELP = "Four numbers in seconds: lowering, pause at the bottom, lifting, pause at the top. X means as fast as possible.";

export function WorkoutForm({
  day,
  editing,
  start = null,
  onDone,
}: {
  day: string;
  editing: Entry | null;
  start?: PlanStart | null;
  /** Called when the form is cleared: with the exercise just saved, or nothing on cancel. */
  onDone: (savedExerciseId?: string) => void;
}) {
  const { exercises, entries, saveEntry, me, profile, plansByDate, actorLabel } = useLog();
  const pickable = usePickableExercises();
  const [draft, setDraft] = useState(blankDraft);
  const [loaded, setLoaded] = useState<Entry | null>(null);
  const [loadedStart, setLoadedStart] = useState<PlanStart | null>(null);
  const [status, setStatus] = useState<{ text: string; kind: "ok" | "err" | "" }>({ text: "", kind: "" });
  const [invalidExercise, setInvalidExercise] = useState(false);
  const [custom, setCustom] = useState<{ name: string; exercise?: Exercise } | null>(null);

  // The form owns its draft, and `editing` is a request to load one. A failed save
  // can then put the typed values back without being overwritten.
  if (editing !== loaded) {
    setLoaded(editing);
    if (editing) {
      setDraft(draftOf(editing, exercises.find((e) => e.id === editing.exercise_id)));
      setStatus({ text: "", kind: "" });
      setInvalidExercise(false);
    }
  }
  if (start !== loadedStart) {
    setLoadedStart(start);
    if (start) {
      setDraft(draftOfPlan(start, exercises.find((e) => e.id === start.item.exercise_id)));
      setStatus({ text: "", kind: "" });
      setInvalidExercise(false);
    }
  }

  // The day's plan can prescribe a tempo for an exercise (PRD 5.3).
  const plan = plansByDate.get(day);
  const plannedFor = (exerciseId: string | null) => plan?.items.find((i) => i.exercise_id === exerciseId);
  const planned = plannedFor(draft.exerciseId);
  const tempoBy = !plan?.assigned_by || plan.assigned_by === profile.id ? null : actorLabel(plan.assigned_by);

  const exercise = exercises.find((e) => e.id === draft.exerciseId);
  const kind: ExerciseKind = exercise?.kind ?? "weighted";
  const assisted = !!exercise?.assisted;
  const variants = variantSuggestions(entries, draft.exerciseId, COMMON_VARIANTS);
  const update = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));
  const setRows = (rows: DraftRow[]) => update({ rows });

  // Anything typed stays visible, so a value from before switching exercise can't save unseen.
  const typed = METRICS.filter((m) => draft.rows.some((r) => r.values[m]?.trim()));
  const columns = METRICS.filter((m) => columnsFor(exercise).includes(m) || typed.includes(m));
  const showTempo = exercise ? exercise.inputs.includes("tempo") || !!draft.tempo || draft.perSetTempo || !!planned?.target_tempo : false;
  const labels = setLabels(draft.rows);
  const pairOf = (i: number) => labels[i].replace(/ [LR]$/, "");

  const pick = (next: Exercise) => {
    setInvalidExercise(false);
    const item = plannedFor(next.id);
    setDraft((d) => ({
      ...d,
      exerciseId: next.id,
      query: next.name,
      rows: fitRows(d.rows, next.per_side),
      // A new entry for a planned exercise takes the plan's tempo and variant.
      tempo: !d.id && !d.tempo && item?.target_tempo ? item.target_tempo : d.tempo,
      variant: !d.id && !d.variant && item?.variant ? item.variant : d.variant,
    }));
  };

  const cancel = () => {
    setDraft(blankDraft());
    setStatus({ text: "", kind: "" });
    setInvalidExercise(false);
    onDone();
  };

  const setValue = (key: string, metric: Metric, value: string) =>
    setRows(draft.rows.map((r) => (r.key === key ? { ...r, values: { ...r.values, [metric]: value } } : r)));

  /** New sets take the last set's numbers, so 3×12 at one weight is a few taps. */
  const addSet = () => {
    const sided = draft.rows.some((r) => r.side);
    const copy = (r: DraftRow | undefined, side: Side | null) => ({ ...row(side, { ...r?.values }), tempo: r?.tempo ?? "" });
    const rows = draft.rows;
    const added = sided
      ? [copy(rows.findLast((r) => r.side === "left"), "left"), copy(rows.findLast((r) => r.side === "right"), "right")]
      : [copy(rows.at(-1), null)];
    setRows([...rows, ...added]);
  };

  /** One row always stays, so the form is never empty. Left and right go together. */
  const removeSet = (i: number) => {
    const pair = pairOf(i);
    const rest = draft.rows.filter((_, n) => pairOf(n) !== pair);
    if (rest.length) return setRows(rest);
    setRows(draft.rows.map((r) => ({ ...r, tempo: "", values: {} })));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const chosen = exercise && cleanName(draft.query).toLowerCase() === exercise.name.toLowerCase() ? exercise : findByName(pickable, draft.query);
    const fail = (text: string) => setStatus({ text, kind: "err" });

    if (!chosen) {
      setInvalidExercise(true);
      if (cleanName(draft.query)) {
        setCustom({ name: cleanName(draft.query) });
        return fail("That exercise isn't in the library yet. Add it as a custom exercise.");
      }
      return fail("Pick an exercise.");
    }
    const tempo = draft.tempo.trim().toUpperCase();
    if (tempo && !TEMPO.test(tempo)) return fail("Write the tempo like 3-1-1-0, using X for as fast as possible.");

    const rows = draft.perSetTempo ? draft.rows : draft.rows.map((r) => ({ ...r, tempo: "" }));
    const { sets, error } = readRows(rows, chosen.kind);
    if (error) return fail(error);
    if (!sets.length) return fail("Add at least one set with numbers in it.");

    const dayEntries = entries.filter((e) => e.date === day);
    const entry: Entry = {
      id: draft.id ?? draft.retryId ?? newId(),
      date: day,
      exercise_id: chosen.id,
      position: entries.find((e) => e.id === draft.id)?.position ?? Math.max(-1, ...dayEntries.map((e) => e.position)) + 1,
      variant: draft.variant.trim() || null,
      notes: draft.notes.trim() || null,
      tempo: tempo || null,
      sets,
    };

    const saved = draft;
    const verb = draft.id ? "Updated" : "Saved";
    // Shown straight away. If the database says no, the typed values come back.
    setDraft(blankDraft());
    onDone(draft.id ? undefined : chosen.id);
    setStatus({ text: `${verb}: ${chosen.name} on ${dayMonth(day)}.`, kind: "ok" });
    if (!(await saveEntry(entry, chosen.name))) {
      setDraft({ ...saved, retryId: entry.id });
      setStatus({ text: "That didn't save, so your numbers are back in the form. Try again.", kind: "err" });
    }
  }

  return (
    <>
      <form className="form-wrap" onSubmit={submit} noValidate>
        {draft.id && (
          <div className="editing-banner">
            <span>Editing “{exercise?.name}”</span>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
        <div className="form-title">{draft.id ? "Edit exercise" : "Add an exercise"}</div>

        <div className="ffield">
          <label htmlFor="f-exercise">Exercise</label>
          <ExercisePicker
            id="f-exercise"
            query={draft.query}
            selected={exercise}
            invalid={invalidExercise}
            onQuery={(query) => update({ query })}
            onSelect={pick}
            onCustom={(name) => setCustom({ name })}
          />
          {exercise?.is_custom && exercise.created_by === me.id && (
            <button type="button" className="link-btn" onClick={() => setCustom({ name: "", exercise })}>
              Edit this custom exercise
            </button>
          )}
        </div>

        <div className="ffield">
          <label htmlFor="f-variant">
            Variant <span className="opt">(optional)</span>
          </label>
          {/* Pick one you've used before or a common one, or write your own. */}
          <input
            id="f-variant"
            list="f-variant-options"
            value={draft.variant}
            maxLength={100}
            autoComplete="off"
            placeholder="Which machine, grip or angle"
            onChange={(e) => update({ variant: e.target.value })}
          />
          <datalist id="f-variant-options">
            {variants.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>

        {showTempo && (
          <div className="ffield">
            <label htmlFor="f-tempo">
              Tempo <span className="opt">(optional)</span>
            </label>
            <input
              id="f-tempo"
              value={draft.tempo}
              maxLength={7}
              autoComplete="off"
              placeholder="3-1-1-0"
              aria-describedby="f-tempo-help"
              onChange={(e) => update({ tempo: e.target.value })}
            />
            {planned?.target_tempo && (
              <div className="set-by" id="f-tempo-plan">
                {tempoBy === "You" ? "You set" : tempoBy ? `Set by ${tempoBy}:` : "Your routine says"} {planned.target_tempo}
              </div>
            )}
            <div className="sb-hint" id="f-tempo-help">
              {TEMPO_HELP}
            </div>
            <label className="chk tempo-each">
              <input type="checkbox" checked={draft.perSetTempo} onChange={(e) => update({ perSetTempo: e.target.checked })} />
              A different tempo on some sets
            </label>
          </div>
        )}

        <div className="field-label">Sets</div>
        <div className="set-builder">
          {draft.rows.map((r, i) => (
            <div className="sb-row" key={r.key}>
              <span className="sb-n">{labels[i]}</span>
              <div className="sb-fields">
                {columns.map((metric) => (
                  <input
                    key={metric}
                    type={metric === "duration_s" ? "text" : "number"}
                    inputMode={metric === "duration_s" ? undefined : metric === "weight_kg" || metric === "distance_km" || metric === "rpe" ? "decimal" : "numeric"}
                    min={metric === "duration_s" ? undefined : metric === "rpe" ? 1 : 0}
                    max={metric === "rpe" ? 10 : undefined}
                    step={metric === "duration_s" ? undefined : "any"}
                    placeholder={
                      metric === "duration_s"
                        ? timeUnit(kind)
                        : metric === "weight_kg" && assisted
                          ? "assist kg"
                          : metric === "weight_kg" && (kind === "bodyweight" || kind === "timed")
                            ? "+kg"
                            : PLACEHOLDERS[metric]
                    }
                    aria-label={`${labels[i]} ${metric === "weight_kg" && assisted ? "assistance in kg" : ARIA[metric]}`}
                    value={r.values[metric] ?? ""}
                    onChange={(e) => setValue(r.key, metric, e.target.value)}
                  />
                ))}
                {draft.perSetTempo && (
                  <input
                    placeholder="3-1-1-0"
                    maxLength={7}
                    aria-label={`${labels[i]} tempo`}
                    value={r.tempo}
                    onChange={(e) => setRows(draft.rows.map((x) => (x.key === r.key ? { ...x, tempo: e.target.value } : x)))}
                  />
                )}
              </div>
              {r.side === "right" && labels[i - 1] && pairOf(i - 1) === pairOf(i) ? (
                <span aria-hidden="true" />
              ) : (
                <button type="button" className="sb-del" aria-label={`Remove ${pairOf(i)}`} onClick={() => removeSet(i)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="sb-add" onClick={addSet}>
          + Add set
        </button>
        <div className="sb-hint">{assisted ? ASSISTED_HINT : HINTS[kind]}</div>

        <div className="ffield notes-field">
          <label htmlFor="f-notes">
            Notes <span className="opt">(optional)</span>
          </label>
          <textarea
            id="f-notes"
            value={draft.notes}
            maxLength={500}
            placeholder="Felt heavy, last set to failure…"
            onChange={(e) => update({ notes: e.target.value })}
          />
        </div>

        <button type="submit" className="save-btn">
          {draft.id ? "Update exercise" : "Save exercise"}
        </button>
        <div className={`status ${status.kind}`} role="status">
          {status.text}
        </div>
      </form>

      {custom && (
        <CustomExerciseForm
          initialName={custom.name}
          exercise={custom.exercise}
          onUse={(chosen) => {
            pick(chosen);
            setCustom(null);
          }}
          onSaved={(saved) => {
            pick(saved);
            setStatus({ text: "", kind: "" });
            setCustom(null);
          }}
          onClose={() => setCustom(null)}
        />
      )}
    </>
  );
}
