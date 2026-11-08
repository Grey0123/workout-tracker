"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import type { PlanStart } from "@/components/log/workout-form";
import { dayMonth, todayKey } from "@/lib/log/dates";
import { plural } from "@/lib/log/sets";
import * as api from "@/lib/routines/api";
import { plannedSets, planStatus, routineFromDay, STATUS_LABEL, targetLabel, type Plan, type Routine } from "@/lib/routines/plan";

/** "Your routine", "Coach Andi's plan", or for a coach, "Your plan". */
export function usePlanOwner() {
  const { profile, isOwn, actorLabel } = useLog();
  return (plan: Plan) => {
    if (!plan.assigned_by) return "Plan";
    if (plan.assigned_by === profile.id) return isOwn ? "Your routine" : `${profile.display_name}'s routine`;
    const who = actorLabel(plan.assigned_by);
    return who === "You" ? "Your plan" : `${who}'s plan`;
  };
}

/** The first planned exercise not logged yet, ready for the form. */
export function nextStart(plan: Plan, ctx: ReturnType<typeof useLog>, skip: string | null = null): PlanStart | null {
  const logged = new Set((ctx.byDate.get(plan.date) ?? []).map((e) => e.exercise_id));
  const item = plan.items.find((i) => !logged.has(i.exercise_id) && i.exercise_id !== skip);
  if (!item) return null;
  const exercise = ctx.exercises.find((e) => e.id === item.exercise_id);
  return { item, sets: plannedSets(item, exercise, ctx.entries, plan.date) };
}

/** A day's plan: what it asks for, what's logged, and a Log button for the rest (PRD 5.3). */
export function PlanCard({ day, active, onLog }: { day: string; active: string | null; onLog: (start: PlanStart) => void }) {
  const log = useLog();
  const { plansByDate, byDate, exercises, entries, isOwn, can, me, update, toast } = log;
  const owner = usePlanOwner();
  const [busy, setBusy] = useState(false);
  const plan = plansByDate.get(day);
  if (!plan) return <StartRoutine day={day} />;

  const dayEntries = byDate.get(day) ?? [];
  const logged = new Set(dayEntries.map((e) => e.exercise_id));
  const status = planStatus(plan, dayEntries.length > 0, todayKey());
  const canRemove = isOwn || (plan.assigned_by === me.id && can.workouts);
  const next = plan.items.find((i) => !logged.has(i.exercise_id));

  const replacePlan = (change: (p: Plan) => Plan | null) =>
    update((d) => ({ ...d, plans: d.plans.flatMap((p) => (p.id === plan.id ? [change(p)].filter((x): x is Plan => !!x) : [p])) }));

  async function skip() {
    setBusy(true);
    const skipped = !plan!.skipped_at;
    try {
      await api.skipPlan(plan!.id, skipped);
      replacePlan((p) => ({ ...p, skipped_at: skipped ? new Date().toISOString() : null }));
      toast(skipped ? `Skipped ${plan!.name}` : `${plan!.name} is back on`);
    } catch (err) {
      console.error(err);
      toast(api.routineError(err), "err");
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm(`Remove ${plan!.name} from ${dayMonth(day)}? What's logged stays.`)) return;
    setBusy(true);
    try {
      await api.removePlan(plan!.id);
      replacePlan(() => null);
      toast(`Removed ${plan!.name}`);
    } catch (err) {
      console.error(err);
      toast(api.routineError(err), "err");
    }
    setBusy(false);
  }

  return (
    <section className={`plan-card status-${status}`} aria-label={`Plan: ${plan.name}`}>
      <div className="plan-head">
        <div>
          <div className="field-label">{owner(plan)}</div>
          <div className="plan-name">{plan.name}</div>
        </div>
        <span className="plan-status">{STATUS_LABEL[status]}</span>
      </div>
      {plan.notes && <div className="plan-notes">{plan.notes}</div>}
      <ol className="plan-items">
        {plan.items.map((item, i) => {
          const exercise = exercises.find((e) => e.id === item.exercise_id);
          const done = logged.has(item.exercise_id);
          const name = exercise?.name ?? "Exercise";
          return (
            <li key={`${item.exercise_id}-${i}`} className={`${done ? "logged" : ""}${active === item.exercise_id ? " active" : ""}`}>
              <span className="pi-n" aria-hidden="true">
                {done ? "✓" : i + 1}
              </span>
              <span className="pi-body">
                <span className="pi-name">
                  {name}
                  {item.variant && <span className="pi-variant"> · {item.variant}</span>}
                </span>
                {targetLabel(item) && <span className="pi-target">{targetLabel(item)}</span>}
                {item.notes && <span className="pi-note">{item.notes}</span>}
              </span>
              {done ? (
                <span className="pi-done">Logged</span>
              ) : (
                can.workouts &&
                status !== "skipped" && (
                  <button
                    type="button"
                    className={`btn sm${item === next ? "" : " ghost"}`}
                    aria-label={`Log ${name}`}
                    onClick={() => onLog({ item, sets: plannedSets(item, exercise, entries, day) })}
                  >
                    Log
                  </button>
                )
              )}
            </li>
          );
        })}
      </ol>
      {((isOwn && status !== "done") || canRemove) && (
        <div className="plan-actions">
          {isOwn && status !== "done" && (
            <button type="button" className="link-btn" disabled={busy} onClick={skip}>
              {plan.skipped_at ? "Not skipped after all" : "Skip this day"}
            </button>
          )}
          {canRemove && (
            <button type="button" className="link-btn danger" disabled={busy} onClick={remove}>
              Remove plan
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Puts one of my routines on the day: my own day, or a client's as their coach. */
function StartRoutine({ day }: { day: string }) {
  const { routines, profile, me, isOwn, can, update, toast } = useLog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!can.workouts) return null;

  async function start(routine: Routine) {
    setBusy(true);
    try {
      const id = await api.planRoutine(routine.id, profile.id, day);
      const plan: Plan = {
        id, date: day, name: routine.name, notes: routine.notes, template_id: routine.id, assigned_by: me.id, skipped_at: null, items: routine.items,
      };
      update((d) => ({ ...d, plans: [...d.plans.filter((p) => p.date !== day), plan] }));
      toast(isOwn ? `${routine.name} is on ${dayMonth(day)}` : `Planned ${routine.name} for ${profile.display_name}, who was notified`);
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast(api.routineError(err), "err");
    }
    setBusy(false);
  }

  const label = isOwn ? "Start a routine" : `Plan a routine for ${profile.display_name}`;
  return (
    <div className="start-routine">
      <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="routine-menu">
          {routines.length ? (
            <ul>
              {routines.map((r) => (
                <li key={r.id}>
                  <button type="button" disabled={busy} onClick={() => start(r)}>
                    <b>{r.name}</b>
                    <span>{plural(r.items.length, "exercise")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cx-hint">
              {isOwn ? "You haven't made a routine yet." : "Make a routine first, then plan it on any of their days."}
            </p>
          )}
          <Link href="/routines" className="link-btn">
            {routines.length ? "Manage routines" : "Make a routine"}
          </Link>
        </div>
      )}
    </div>
  );
}

/** "Save this day as a routine", so a good session can be repeated (PRD 5.6, duplicate a workout). */
export function SaveDayAsRoutine({ day }: { day: string }) {
  const { byDate, exercises, me, routines, update, toast, readOnly } = useLog();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const dayEntries = byDate.get(day) ?? [];
  if (readOnly || !dayEntries.length) return null;

  // Only exercises I may put in my own routines: built-in ones and my own.
  const usable = (id: string) => {
    const e = exercises.find((x) => x.id === id);
    return !!e && (!e.is_custom || e.created_by === me.id);
  };
  const all = routineFromDay(dayEntries);
  const items = all.filter((i) => usable(i.exercise_id));

  async function save(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const id = await api.saveRoutine(null, clean, null, items);
      update((d) => ({
        ...d,
        routines: [...d.routines, { id, name: clean, notes: null, updated_at: new Date().toISOString(), items }].sort((a, b) => a.name.localeCompare(b.name)),
      }));
      const left = all.length - items.length;
      toast(left ? `Saved ${clean}, without ${plural(left, "custom exercise")} that aren't yours` : `Saved routine ${clean}`);
      setNaming(false);
      setName("");
    } catch (err) {
      console.error(err);
      toast(api.routineError(err), "err");
    }
    setBusy(false);
  }

  if (!items.length) return null;
  if (!naming)
    return (
      <button type="button" className="link-btn save-day" onClick={() => setNaming(true)}>
        Save this day as a routine
      </button>
    );
  return (
    <form className="save-day-form" onSubmit={save}>
      <input
        aria-label="Routine name"
        placeholder="Routine name, like Push Day"
        maxLength={60}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn sm" disabled={busy || !name.trim()}>
        Save
      </button>
      <button type="button" className="btn ghost sm" onClick={() => setNaming(false)}>
        Cancel
      </button>
      {routines.some((r) => r.name.toLowerCase() === name.trim().toLowerCase()) && (
        <div className="cx-hint">You already have a routine with that name.</div>
      )}
    </form>
  );
}
