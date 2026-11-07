"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { photoLink, resizePhoto } from "@/lib/log/api";
import { dayMonth } from "@/lib/log/dates";
import { MEAL_SLOTS, type Meal, type MealSlot } from "@/lib/log/types";
import { useByLine } from "./activities";
import { useLog } from "./log-provider";

/** A private photo, shown through a short-lived link. */
export function MealPhoto({ path, preview, className = "meal-photo" }: { path: string | null; preview?: string; className?: string }) {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path || preview) return;
    let live = true;
    photoLink(path).then(
      (url) => live && setLoaded({ path, url }),
      (err) => {
        console.error(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [path, preview]);

  const url = preview ?? (loaded?.path === path ? loaded?.url : undefined);
  if (failed && !url) return <span className="photo-failed">Photo couldn&apos;t be loaded.</span>;
  if (!url) return null;
  // Signed URLs from private storage, which Next's image optimiser can't fetch.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={url} alt="Meal photo" loading="lazy" />;
}

function MealByLine({ meal }: { meal: Meal }) {
  const line = useByLine(meal);
  return line ? <span className="by-tag">{line}</span> : null;
}

export function MealsList({
  day,
  onPick,
  onDeleted,
  onHistory,
}: {
  day: string;
  onPick: (slot: MealSlot) => void;
  onDeleted: () => void;
  onHistory?: (meal: Meal) => void;
}) {
  const { mealsByDate, deleteMeal, readOnly, shares, can, isOwn, profile } = useLog();
  const meals = mealsByDate.get(day) ?? {};

  const remove = (meal: Meal) => {
    const whose = isOwn ? "your" : `${profile.display_name}'s`;
    if (!confirm(`Delete ${whose} ${meal.slot} meal on ${dayMonth(day)}?`)) return;
    deleteMeal(meal);
    onDeleted();
  };

  return (
    <div className="meal-group">
      {MEAL_SLOTS.map((slot) => {
        const meal = meals[slot];
        return (
          <div className="meal-slot" key={slot}>
            <span className="slot-tag">{slot}</span>
            <span className="slot-body">
              {meal ? (
                <>
                  {meal.description}
                  {meal.notes && <span className="meal-note"> · {meal.notes}</span>}
                  {shares.mealPhotos && (meal.photo_path || meal.photo_preview) && (
                    <MealPhoto path={meal.photo_path} preview={meal.photo_preview} />
                  )}
                  <MealByLine meal={meal} />
                  {meal.saving && <span className="act-saving">Saving…</span>}
                </>
              ) : (
                <span className="empty">not logged</span>
              )}
            </span>
            {readOnly ? null : meal ? (
              !meal.saving && (
                <span className="slot-btns">
                  {can.meals && (
                    <button type="button" className="btn ghost sm" aria-label={`Edit ${slot} meal`} onClick={() => onPick(slot)}>
                      Edit
                    </button>
                  )}
                  {onHistory && (
                    <button type="button" className="btn ghost sm" aria-label={`History of ${slot} meal`} onClick={() => onHistory(meal)}>
                      History
                    </button>
                  )}
                  {can.delete && (
                    <button type="button" className="btn ghost sm danger" aria-label={`Delete ${slot} meal`} onClick={() => remove(meal)}>
                      Delete
                    </button>
                  )}
                </span>
              )
            ) : (
              can.meals && (
                <button type="button" className="btn ghost sm slot-add" aria-label={`Add ${slot} meal`} onClick={() => onPick(slot)}>
                  Add
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Remount with a new key to switch day or slot: it starts from what's saved there. */
export function MealForm({ day, slot, onSlot }: { day: string; slot: MealSlot; onSlot: (slot: MealSlot) => void }) {
  const { mealsByDate, saveMeal, toast } = useLog();
  const existing = mealsByDate.get(day)?.[slot];
  const [food, setFood] = useState(existing?.description ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "ok" | "err" | "" }>(
    existing ? { text: "Already logged. Saving will update this entry.", kind: "" } : { text: "", kind: "" },
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const savedPhoto = !removed && !photo ? existing?.photo_path ?? null : null;
  const hasPhoto = !!photo || !!savedPhoto;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const blob = await resizePhoto(file);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
      setRemoved(false);
    } catch (err) {
      toast((err as Error).message, "err");
    }
  }

  const clearPhoto = () => {
    setPhoto(null);
    setRemoved(true);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const description = food.trim();
    if (!description && !hasPhoto) {
      setStatus({ text: "Add what you ate, or attach a photo.", kind: "err" });
      return;
    }
    const chosen = photo;
    const wasRemoved = removed;
    setStatus({ text: `Saved: ${slot} on ${dayMonth(day)}.`, kind: "ok" });
    setPhoto(null);
    setRemoved(false);
    const ok = await saveMeal({
      date: day,
      slot,
      description: description || null,
      notes: notes.trim() || null,
      photo: chosen?.blob ?? null,
      photoPreview: chosen?.preview ?? null,
      keepPhotoPath: chosen ? null : savedPhoto,
    });
    if (!ok) {
      setPhoto(chosen);
      setRemoved(wasRemoved);
      setStatus({ text: "That didn't save, so your meal is back in the form. Try again.", kind: "err" });
    }
  }

  return (
    <form className="form-wrap" onSubmit={submit} noValidate>
      <div className="form-title">{existing ? `Edit ${slot} meal` : `Log ${slot} meal`}</div>

      <div className="field-label">Meal</div>
      <div className="seg" role="group" aria-label="Meal time">
        {MEAL_SLOTS.map((s) => (
          <button type="button" key={s} className={s === slot ? "active" : ""} aria-pressed={s === slot} onClick={() => onSlot(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="ffield">
        <label htmlFor="m-food">What did you eat?</label>
        <textarea id="m-food" value={food} maxLength={300} placeholder="Oats, 3 eggs, black coffee…" onChange={(e) => setFood(e.target.value)} />
      </div>

      <div className="ffield">
        <label htmlFor="m-notes">
          Notes <span className="opt">(optional)</span>
        </label>
        <input
          id="m-notes"
          value={notes}
          maxLength={500}
          autoComplete="off"
          placeholder="Post-workout / ate out / rough estimate…"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="field-label">
        Photo <span className="opt">(optional)</span>
      </div>
      <div className="photo-pick">
        {hasPhoto && <MealPhoto path={savedPhoto} preview={photo?.preview} className="photo-preview" />}
        <input ref={fileInput} type="file" accept="image/*" aria-label="Meal photo" onChange={choose} />
        <button type="button" className="btn ghost block" onClick={() => fileInput.current?.click()}>
          {hasPhoto ? "Change photo" : "Choose photo"}
        </button>
        {hasPhoto && (
          <button type="button" className="btn ghost block remove-photo" onClick={clearPhoto}>
            Remove photo
          </button>
        )}
        <div className="hint">Private to you. Resized before upload.</div>
      </div>

      <button type="submit" className="save-btn" disabled={existing?.saving}>
        {existing?.saving ? "Saving…" : "Save meal"}
      </button>
      <div className={`status ${status.kind}`} role="status">
        {status.text}
      </div>
    </form>
  );
}
