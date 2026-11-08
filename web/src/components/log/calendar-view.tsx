"use client";

import { useEffect, useRef, useState } from "react";
import { dateOf, dayMonth, longDate, monthGrid, niceDate, panelDate, sameMonth, todayKey } from "@/lib/log/dates";
import { entriesSets, entriesVolume, fmtVolume, plural } from "@/lib/log/sets";
import type { Entry, MealSlot } from "@/lib/log/types";
import { HistoryDialog, type HistoryTarget } from "@/components/coach/history-dialog";
import * as coach from "@/lib/coach/api";
import { Activities } from "./activities";
import { useLog } from "./log-provider";
import { MealForm, MealsList } from "./meals";
import { WorkoutForm, type PlanStart } from "./workout-form";
import { nextStart, PlanCard, SaveDayAsRoutine } from "@/components/routines/plan-card";

/** The coach's plan for the week holding the selected day (design: pinned on the calendar). */
function PlanBanner() {
  const { notes, selectedDay, actorLabel } = useLog();
  const plan = coach.planFor(notes, selectedDay);
  if (!plan) return null;
  return (
    <div className="plan-banner">
      <div className="field-label">
        {actorLabel(plan.coach_id) === "You" ? "Your plan" : `${actorLabel(plan.coach_id)}'s plan`} · week of {dayMonth(plan.week_start!)}
      </div>
      <div>{plan.body}</div>
    </div>
  );
}

function MonthGrid({ onPick }: { onPick: (day: string) => void }) {
  const { byDate, mealsByDate, plansByDate, selectedDay, month, showMonth, showToday, profile, entries, meals: allMeals, isOwn } = useLog();
  const today = todayKey();
  // Days someone other than the owner added to or changed (design: a dot on the day).
  const touched = new Set(
    [...entries, ...allMeals]
      .filter((r) => (r.created_by && r.created_by !== profile.id) || (r.updated_by && r.updated_by !== profile.id))
      .map((r) => r.date),
  );

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
          const plan = plansByDate.get(day);
          if (plan && !rows.length && !plan.skipped_at) classes.push("planned");

          const bits: string[] = [];
          if (rows.length) bits.push(plural(rows.length, "exercise"));
          if (meals) bits.push(plural(meals, "meal"));
          if (plan) bits.push(`${plan.name} planned`);

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
              {touched.has(day) && <span className="touched-dot" title="Changed by someone else" />}
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
        {plansByDate.size > 0 && (
          <span>
            <span className="key planned" />
            planned
          </span>
        )}
        {touched.size > 0 && (
          <span>
            <span className="key dot" />
            changed by {isOwn ? "your coach" : "someone else"}
          </span>
        )}
      </div>
      <PlanBanner />
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
    shares,
    profile,
    can,
    readOnly,
    notes,
    actorLabel,
  } = useLog();
  const [history, setHistory] = useState<HistoryTarget | null>(null);
  const dayNotes = notes.filter((n) => n.kind === "day" && n.date === selectedDay);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [start, setStart] = useState<PlanStart | null>(null);
  const log = useLog();
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
    setStart(null);
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const edit = (entry: Entry) => {
    setEditing(entry);
    setStart(null);
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

        {dayNotes.map((n) => (
          <div className="day-note" key={n.id}>
            <div className="field-label">Day note · {actorLabel(n.coach_id)}</div>
            <div>{n.body}</div>
          </div>
        ))}

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
            {shares.workouts && (
              <PlanCard
                day={selectedDay}
                active={start?.item.exercise_id ?? null}
                onLog={(next) => {
                  setEditing(null);
                  setStart(next);
                  form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            )}
            {shares.workouts ? (
              <div className="entries">
                <Activities
                  entries={rows}
                  onEdit={can.workouts ? edit : undefined}
                  onDelete={can.delete ? remove : undefined}
                  onHistory={readOnly ? undefined : (entry, name) => setHistory({ table: "session_exercises", id: entry.id, title: name })}
                />
              </div>
            ) : (
              <div className="no-entries">{profile.display_name} isn&apos;t sharing workouts with you.</div>
            )}
            {shares.workouts && <SaveDayAsRoutine day={selectedDay} />}
            {can.workouts && (
              <div ref={form}>
                <WorkoutForm
                  key={selectedDay}
                  day={selectedDay}
                  editing={editing}
                  start={start}
                  onDone={(saved) => {
                    setEditing(null);
                    // Logging a planned exercise moves on to the next one, so a plan is a few confirms.
                    const plan = log.plansByDate.get(selectedDay);
                    setStart(saved && start && plan ? nextStart(plan, log, saved) : null);
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <div role="tabpanel">
            {shares.meals ? (
              <MealsList
                day={selectedDay}
                onPick={pickSlot}
                onDeleted={() => setMealVersion((n) => n + 1)}
                onHistory={readOnly ? undefined : (meal) => setHistory({ table: "meals", id: meal.id, title: `${meal.slot} meal` })}
              />
            ) : (
              <div className="no-entries">{profile.display_name} isn&apos;t sharing meals with you.</div>
            )}
            {can.meals && (
              <div ref={form}>
                <MealForm key={`${selectedDay}-${slot}-${mealVersion}`} day={selectedDay} slot={slot} onSlot={setSlot} />
              </div>
            )}
          </div>
        )}
      </div>
      {history && <HistoryDialog target={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
