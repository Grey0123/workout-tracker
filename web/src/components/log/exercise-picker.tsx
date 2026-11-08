"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cleanName, recentExercises } from "@/lib/log/sets";
import { CATEGORIES, type Exercise } from "@/lib/log/types";
import { useLog } from "./log-provider";

/**
 * Built-ins and custom exercises of the log's owner, plus a coach's own: the ones that may be
 * logged here. A coach's custom exercise in one of the owner's plans counts too.
 */
export function usePickableExercises(): Exercise[] {
  const { exercises, profile, me, plans } = useLog();
  return useMemo(() => {
    const planned = new Set(plans.flatMap((p) => p.items.map((i) => i.exercise_id)));
    return exercises.filter((e) => !e.is_custom || e.created_by === profile.id || e.created_by === me.id || planned.has(e.id));
  }, [exercises, profile.id, me.id, plans]);
}

export const findByName = (list: Exercise[], name: string) => {
  const key = cleanName(name).toLowerCase();
  return list.find((e) => e.name.toLowerCase() === key);
};

type Group = { label: string; items: Exercise[] };

/** A searchable dropdown grouped by target muscle. Anything not listed can be added as custom. */
export function ExercisePicker({
  id,
  query,
  selected,
  invalid,
  onQuery,
  onSelect,
  onCustom,
  pool,
}: {
  id: string;
  query: string;
  selected: Exercise | undefined;
  invalid: boolean;
  onQuery: (text: string) => void;
  onSelect: (exercise: Exercise) => void;
  onCustom: (name: string) => void;
  /** Offer only these, instead of everything that may be logged here. */
  pool?: Exercise[];
}) {
  const { entries } = useLog();
  const loggable = usePickableExercises();
  const pickable = pool ?? loggable;
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const groups = useMemo<Group[]>(() => {
    const key = cleanName(query).toLowerCase();
    // Once picked, the box shows the name. Reopening it shows the whole list again.
    const searching = key && key !== selected?.name.toLowerCase();
    const matches = (e: Exercise) => !searching || e.name.toLowerCase().includes(key) || e.category.toLowerCase().includes(key);
    const result: Group[] = [];
    if (!searching) {
      const recent = recentExercises(entries)
        .map((exerciseId) => pickable.find((e) => e.id === exerciseId))
        .filter((e): e is Exercise => !!e);
      if (recent.length) result.push({ label: "Recent", items: recent });
    }
    for (const label of CATEGORIES) {
      // A name starting with what's typed comes first, so "lat pull" finds Lat Pulldown.
      const starts = (e: Exercise) => (searching && e.name.toLowerCase().startsWith(key) ? 0 : 1);
      const items = pickable
        .filter((e) => e.category === label && matches(e))
        .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name));
      if (items.length) result.push({ label, items });
    }
    return result;
  }, [query, selected, entries, pickable]);

  const flat = groups.flatMap((g) => g.items.map((exercise) => ({ exercise, group: g.label })));
  const optionId = (i: number) => `${listId}-${i}`;
  const typed = cleanName(query);

  const choose = (exercise: Exercise) => {
    onSelect(exercise);
    setOpen(false);
    setActive(-1);
  };

  const custom = () => {
    setOpen(false);
    onCustom(typed && !findByName(pickable, typed) ? typed : "");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(-1, Math.min(flat.length - 1, i + step)));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const exact = findByName(pickable, typed);
      if (active >= 0 && flat[active]) choose(flat[active].exercise);
      else if (exact) choose(exact);
      else if (flat.length === 1) choose(flat[0].exercise);
      else if (typed) custom();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  let index = -1;
  return (
    <div className="picker">
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        maxLength={60}
        placeholder="Search or pick an exercise"
        value={query}
        onChange={(event) => {
          onQuery(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(event) => {
          event.target.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          const exact = findByName(pickable, typed);
          if (exact && exact.id !== selected?.id) onSelect(exact);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        // Pressing the list mustn't blur the box, or it would close before the click lands.
        <div className="picker-menu" onMouseDown={(event) => event.preventDefault()}>
          <ul id={listId} role="listbox" aria-label="Exercises">
            {groups.map((group) => (
              <li key={group.label} role="presentation">
                <div className="picker-group" role="presentation">
                  {group.label}
                </div>
                <ul role="group" aria-label={group.label}>
                  {group.items.map((exercise) => {
                    index++;
                    const i = index;
                    return (
                      <li
                        key={exercise.id}
                        id={optionId(i)}
                        role="option"
                        aria-selected={exercise.id === selected?.id}
                        className={`picker-option${i === active ? " active" : ""}`}
                        onClick={() => choose(exercise)}
                      >
                        <span>{exercise.name}</span>
                        <small>{exercise.is_custom ? "Custom" : exercise.equipment === "None" ? "" : exercise.equipment}</small>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {!groups.length && <li className="picker-none">No match in the library.</li>}
          </ul>
          <button type="button" className="picker-custom" onClick={custom}>
            + Custom exercise{typed && !findByName(pickable, typed) ? `: “${typed}”` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
