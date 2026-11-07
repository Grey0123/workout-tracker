"use client";

import { useEffect, useRef, useState } from "react";
import { dateOf, longDate, monthGrid, niceDate, panelDate, sameMonth, todayKey } from "@/lib/log/dates";
import { entriesSets, entriesVolume, fmtVolume, plural } from "@/lib/log/sets";
import type { Entry, MealSlot } from "@/lib/log/types";
import { Activities } from "./activities";
import { useLog } from "./log-provider";
import { MealForm, MealsList } from "./meals";
import { WorkoutForm } from "./workout-form";

function MonthGrid({ onPick }: { onPick: (day: string) => void }) {
  const { byDate, mealsByDate, selectedDay, month, showMonth, showToday } = useLog();
  const today = todayKey();

  return (
    <div className="card cal-card">
      <div className="cal-head">
        <button type="button" className="nav-btn" aria-label="Previous month" onClick={() => showMonth(-1)}>
          ‹
        </button>
        <h1 className="month">{niceDate(month, { month: "long", year: "numeric" })}</h1>
        <button type="button" className="today-btn" onClick={showToday}>
          Today
        </button>
        <button type="button" className="nav-btn" aria-label="Next month" onClick={() => showMonth(1)}>
          ›
        </button>
      </div>
      <div className="cal-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div className="dow" key={d}>
            {d}
          </div>
        ))}
        {monthGrid(month).map((day) => {
          const rows = byDate.get(day) ?? [];
          const sets = entriesSets(rows);
          const meals = Object.keys(mealsByDate.get(day) ?? {}).length;
          const classes = ["day"];
          if (!sameMonth(day, month)) classes.push("other");
          if (day === today) classes.push("today");
          if (day === selectedDay) classes.push("selected");
          if (rows.length) classes.push("trained");

          const bits: string[] = [];
          if (rows.length) bits.push(plural(rows.length, "exercise"));
          if (meals) bits.push(plural(meals, "meal"));

          return (
            <button
              type="button"
              key={day}
              className={classes.join(" ")}
              aria-label={`${longDate(day)}, ${bits.join(", ") || "nothing logged"}`}
              aria-pressed={day === selectedDay}
              onClick={() => onPick(day)}
            >
              <span className="dnum">{dateOf(day).getDate()}</span>
              <span className="stripes">
                {rows.length > 0 && <span className="stripe work">{sets}</span>}
                {meals > 0 && <span className="stripe food">{meals}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cal-legend">
        <span>
          <span className="key trained" />
          gym day
        </span>
        <span>
          <span className="key" />
          sets done
        </span>
        <span>
          <span className="key food" />
          meals logged
        </span>
      </div>
    </div>
  );
}

export function CalendarView() {
  const {
    byDate,
    mealsByDate,
    selectedDay,
    selectDay,
    pane,
    setPane,
    deleteEntry,
    focusForm,
    clearFocusForm,
    assistedIds,
    readOnly,
    shares,
    profile,
  } = useLog();
  const [editing, setEditing] = useState<Entry | null>(null);
  const [slot, setSlot] = useState<MealSlot>("morning");
  const [mealVersion, setMealVersion] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLDivElement>(null);

  const rows = byDate.get(selectedDay) ?? [];
  const meals = Object.keys(mealsByDate.get(selectedDay) ?? {}).length;
  const summary: string[] = [];
  if (rows.length) summary.push(`${plural(entriesSets(rows), "set")} · ${fmtVolume(entriesVolume(rows, assistedIds))} kg`);
  if (meals) summary.push(plural(meals, "meal"));

  useEffect(() => {
    if (!focusForm) return;
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    clearFocusForm();
  }, [focusForm, clearFocusForm]);

  const pick = (day: string) => {
    selectDay(day);
    // An edit in progress doesn't carry across days.
    setEditing(null);
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const edit = (entry: Entry) => {
    setEditing(entry);
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const remove = (entry: Entry, name: string) => {
    if (!confirm(`Delete “${name}” from ${niceDate(entry.date, { day: "numeric", month: "short" })}?`)) return;
    if (editing?.id === entry.id) setEditing(null);
    deleteEntry(entry, name);
  };

  const pickSlot = (next: MealSlot) => {
    setSlot(next);
    setPane("food");
    form.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="cal-layout">
      <MonthGrid onPick={pick} />

      <div className="card day-panel" ref={panel}>
        <h2 className="day-title">
          <span>{panelDate(selectedDay)}</span>
          <span className="sub">{summary.join(" · ") || "nothing logged yet"}</span>
        </h2>

        <div className="day-toggle" role="tablist" aria-label="Day contents">
          <button type="button" role="tab" aria-selected={pane === "workout"} className={pane === "workout" ? "active" : ""} onClick={() => setPane("workout")}>
            Workout<span className="count">{rows.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={pane === "food"} className={pane === "food" ? "active" : ""} onClick={() => setPane("food")}>
            Food<span className="count">{meals}</span>
          </button>
        </div>

        {pane === "workout" ? (
          <div role="tabpanel">
            {shares.workouts ? (
              <div className="entries">
                <Activities entries={rows} onEdit={readOnly ? undefined : edit} onDelete={readOnly ? undefined : remove} />
              </div>
            ) : (
              <div className="no-entries">{profile.display_name} isn&apos;t sharing workouts with you.</div>
            )}
            {!readOnly && (
              <div ref={form}>
                <WorkoutForm key={selectedDay} day={selectedDay} editing={editing} onDone={() => setEditing(null)} />
              </div>
            )}
          </div>
        ) : (
          <div role="tabpanel">
            {shares.meals ? (
              <MealsList day={selectedDay} onPick={pickSlot} onDeleted={() => setMealVersion((n) => n + 1)} />
            ) : (
              <div className="no-entries">{profile.display_name} isn&apos;t sharing meals with you.</div>
            )}
            {!readOnly && (
              <div ref={form}>
                <MealForm key={`${selectedDay}-${slot}-${mealVersion}`} day={selectedDay} slot={slot} onSlot={setSlot} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
