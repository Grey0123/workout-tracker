"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cleanName, timeUnit } from "@/lib/log/sets";
import { CATEGORIES, EQUIPMENT, METRICS, PRESETS, VARIABLES, type Exercise, type Variable } from "@/lib/log/types";
import { findByName, usePickableExercises } from "./exercise-picker";
import { useLog } from "./log-provider";

const sameVars = (a: Variable[], b: Variable[]) => a.length === b.length && a.every((v) => b.includes(v));

/** Full-screen, as drawn in the mockups. Creates a custom exercise, or edits one when given it. */
export function CustomExerciseForm({
  initialName,
  exercise,
  onSaved,
  onUse,
  onClose,
}: {
  initialName: string;
  exercise?: Exercise;
  onSaved: (exercise: Exercise) => void;
  onUse: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const { saveExercise, toast } = useLog();
  const pickable = usePickableExercises();
  const dialog = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState(exercise?.name ?? initialName);
  const [category, setCategory] = useState(exercise?.category ?? "");
  const [others, setOthers] = useState<string[]>(exercise?.secondary_muscles ?? []);
  const [equipment, setEquipment] = useState(exercise?.equipment ?? "");
  const [inputs, setInputs] = useState<Variable[]>(exercise?.inputs ?? PRESETS[0].inputs);
  const [preset, setPreset] = useState<number | null>(() =>
    exercise ? (() => { const i = PRESETS.findIndex((p) => p.kind === exercise.kind && sameVars(p.inputs, exercise.inputs)); return i < 0 ? null : i; })() : 0,
  );
  const [perSide, setPerSide] = useState(exercise?.per_side ?? false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const clean = cleanName(name);
  const match = clean ? findByName(pickable, clean) : undefined;
  const duplicate = match && match.id !== exercise?.id ? match : undefined;
  const kind = preset !== null ? PRESETS[preset].kind : "custom";

  const toggle = (id: Variable) => {
    const next = inputs.includes(id) ? inputs.filter((v) => v !== id) : [...inputs, id];
    setInputs(next);
    const found = PRESETS.findIndex((p) => sameVars(p.inputs, next));
    setPreset(found < 0 ? null : found);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!clean) return setError("Give the exercise a name.");
    if (duplicate) return setError(`${duplicate.name} already exists. Use that one, or pick another name.`);
    if (!category) return setError("Pick the main muscle group.");
    if (!inputs.length) return setError("Pick at least one variable.");

    setBusy(true);
    setError("");
    try {
      const saved = await saveExercise(exercise?.id ?? null, {
        name: clean,
        category,
        secondary_muscles: others,
        equipment: equipment || null,
        kind,
        inputs,
        per_side: perSide,
      });
      toast(`${exercise ? "Updated" : "Added"}: ${saved.name}`);
      onSaved(saved);
    } catch (err) {
      console.error(err);
      setError("Couldn't save that. Check your connection and try again.");
      setBusy(false);
    }
  }

  const available = CATEGORIES.filter((c) => c !== category && !others.includes(c));

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="custom-title" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <header className="sheet-head">
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
          <div>
            <div className="sheet-kicker">Exercise library</div>
            <h2 id="custom-title" className="sheet-title">
              {exercise ? "Edit exercise" : "Custom exercise"}
            </h2>
          </div>
        </header>

        <div className="sheet-body">
          <section className="card sheet-card" aria-label="About the exercise">
            <div>
              <label htmlFor="cx-name">
                Exercise name <span className="req">*</span>
              </label>
              <input id="cx-name" value={name} maxLength={60} autoComplete="off" onChange={(e) => setName(e.target.value)} />
              {duplicate && (
                <div className="cx-suggest">
                  <span>{duplicate.is_custom ? "You already have" : "The library already has"} {duplicate.name}.</span>
                  <button type="button" onClick={() => onUse(duplicate)}>
                    Use it
                  </button>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="cx-category">
                Main muscle group <span className="req">*</span>
              </label>
              <select
                id="cx-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setOthers(others.filter((o) => o !== e.target.value));
                }}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cx-others">Other muscles worked</label>
              <div className="cx-chips">
                {others.map((muscle) => (
                  <button
                    type="button"
                    key={muscle}
                    className="cx-chip"
                    aria-label={`Remove ${muscle}`}
                    onClick={() => setOthers(others.filter((o) => o !== muscle))}
                  >
                    {muscle} ×
                  </button>
                ))}
              </div>
              <select
                id="cx-others"
                value=""
                onChange={(e) => {
                  if (e.target.value) setOthers([...others, e.target.value]);
                }}
              >
                <option value="">+ Add a muscle group</option>
                {available.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cx-equipment">Equipment</label>
              <select id="cx-equipment" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
                <option value="">Not set</option>
                {EQUIPMENT.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </section>

          <section className="card sheet-card" aria-label="What to log">
            <div>
              <div className="cx-ask">
                What do you want to log? <span className="req">*</span>
              </div>
              <div className="cx-hint">Start from a preset or tick the variables yourself.</div>
            </div>
            <div className="cx-presets">
              {PRESETS.map((p, i) => (
                <button
                  type="button"
                  key={p.label}
                  aria-pressed={preset === i}
                  className={preset === i ? "active" : ""}
                  onClick={() => {
                    setPreset(i);
                    setInputs(p.inputs);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="cx-vars">
              {VARIABLES.map((v) => (
                <label key={v.id} className={`cx-var${inputs.includes(v.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={inputs.includes(v.id)} onChange={() => toggle(v.id)} />
                  <span>
                    <b>{v.label}</b>
                    <small>{v.unit}</small>
                  </span>
                </label>
              ))}
            </div>
            {!inputs.length && <div className="status err">Pick at least one variable.</div>}
            <label className="cx-side">
              <span>
                <b>Log left and right separately</b>
                <small>For one-sided moves like a single-arm row</small>
              </span>
              <input type="checkbox" role="switch" checked={perSide} onChange={(e) => setPerSide(e.target.checked)} />
            </label>
          </section>

          <section className="card sheet-card" aria-label="Preview of the log form">
            <div className="cx-preview-title">Preview · one set</div>
            <div className="cx-preview">
              <span className="cx-preview-n">Set 1</span>
              {METRICS.filter((m) => inputs.includes(m)).map((m) => (
                <span key={m}>{m === "duration_s" ? timeUnit(kind) : VARIABLES.find((v) => v.id === m)?.unit === "count" ? VARIABLES.find((v) => v.id === m)?.label.toLowerCase() : VARIABLES.find((v) => v.id === m)?.unit}</span>
              ))}
              {inputs.includes("tempo") && <span>3-1-1-0</span>}
            </div>
            {perSide && <div className="cx-hint">Each set is logged twice: Left and Right.</div>}
          </section>

          <p className="cx-hint">Only you can pick this exercise. People who can see your workouts will see it in your log.</p>

          {error && (
            <div className="status err" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="save-btn" disabled={busy}>
            {busy ? "Saving…" : "Save exercise"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
