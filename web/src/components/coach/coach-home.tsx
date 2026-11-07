"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLog } from "@/components/log/log-provider";
import { Avatar } from "@/components/people/bits";
import * as coach from "@/lib/coach/api";
import { describeGroup, groupByTx, sentence, type Change } from "@/lib/coach/changes";
import { todayKey } from "@/lib/log/dates";
import { COACH_LABEL } from "@/lib/people/types";
import { HistoryDialog, type HistoryTarget } from "./history-dialog";
import { useChangeContext } from "./use-change-context";

/** The latest change a coach made that you haven't seen, with undo (design: Home banner). */
export function CoachChangeBanner() {
  const { actorLabel, toast, reload, entries, meals } = useLog();
  const ctx = useChangeContext();
  const [latest, setLatest] = useState<{ group: Change[]; ids: string[] } | null>(null);
  const [history, setHistory] = useState<HistoryTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    coach.loadNotifications(60).then(
      (all) => {
        if (!live) return;
        const unread = all.filter((n) => n.type === "coach_change" && !n.read_at);
        const groups = groupByTx(unread.map(coach.notificationChange));
        const group = groups[0];
        const tx = group?.[0].tx;
        setLatest(group ? { group, ids: unread.filter((n) => String(n.payload.tx ?? n.created_at) === tx).map((n) => n.id) } : null);
      },
      (err) => console.error(err),
    );
    return () => {
      live = false;
    };
  }, [version]);

  if (!latest) return null;
  const lines = describeGroup(latest.group, ctx);
  if (!lines.length) return null;
  const first = lines[0];
  const actor = actorLabel(latest.group[0].changed_by);

  const dismiss = async () => {
    await coach.markRead(latest.ids).catch(console.error);
    setVersion((n) => n + 1);
  };

  async function undo() {
    setBusy(true);
    try {
      await coach.undoChanges(latest!.group.map((c) => c.id));
      await coach.markRead(latest!.ids);
      toast("Undone");
      reload();
      setVersion((n) => n + 1);
    } catch (err) {
      console.error(err);
      toast(coach.undoError(err), "err");
    }
    setBusy(false);
  }

  const title = first.target
    ? first.target.table === "meals"
      ? "Meal"
      : (ctx.exerciseName(entries.find((e) => e.id === first.target!.id)?.exercise_id ?? "") ?? "Exercise")
    : "Change";
  const stillThere = first.target && (first.target.table === "meals" ? meals.some((m) => m.id === first.target!.id) : true);

  return (
    <section className="card coach-banner" aria-label="Latest change by your coach">
      <div className="coach-banner-text">
        <p>{sentence(actor, first)}</p>
        {first.details.length > 1 && (
          <ul>
            {first.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {lines.length > 1 && <p className="cx-hint">and {lines.length - 1} more in the same change</p>}
      </div>
      <div className="card-actions">
        {first.target && stillThere && (
          <button type="button" className="btn ghost sm" onClick={() => setHistory({ ...first.target!, title })}>
            History
          </button>
        )}
        <button type="button" className="btn ghost sm" disabled={busy} onClick={undo}>
          {busy ? "Undoing…" : "Undo"}
        </button>
        <button type="button" className="btn ghost sm" onClick={dismiss}>
          OK
        </button>
      </div>
      {history && <HistoryDialog target={history} onClose={() => setHistory(null)} />}
    </section>
  );
}

/** Your coach, their goal and plan for you, and your to-dos (design: Home, "From your coach"). */
export function CoachCard() {
  const { coach: mine, notes, setNotes, toast } = useLog();
  if (!mine) return null;
  const fromCoach = notes.filter((n) => n.coach_id === mine.person.id);
  const goal = coach.currentGoal(fromCoach);
  const plan = coach.planFor(fromCoach, todayKey());
  const reminders = fromCoach
    .filter((n) => n.kind === "reminder")
    .sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at))
    .slice(0, 6);

  async function tick(id: string, done: boolean) {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, done_at: done ? new Date().toISOString() : null } : n)));
    try {
      await coach.setReminderDone(id, done);
    } catch (err) {
      console.error(err);
      setNotes((list) => list.map((n) => (n.id === id ? { ...n, done_at: done ? null : new Date().toISOString() } : n)));
      toast("Couldn't save that. Check your connection.", "err");
    }
  }

  return (
    <>
      <h2 className="section">From your coach</h2>
      <section className="card coach-card">
        <div className="coach-card-head">
          <Avatar person={mine.person} />
          <div className="person-text">
            <div className="person-name">Coach {mine.person.display_name}</div>
            <div className="person-meta coach-label">{COACH_LABEL}</div>
          </div>
          <Link href="/people" className="pill blue link-pill">
            {mine.access === "full" ? "Full control" : "Add & edit"}
          </Link>
        </div>
        {goal && (
          <div className="coach-part">
            <div className="field-label">Current goal</div>
            <div className="coach-goal">{goal.body}</div>
          </div>
        )}
        {plan && (
          <div className="coach-part">
            <div className="field-label">This week&apos;s plan</div>
            <div className="coach-plan">{plan.body}</div>
          </div>
        )}
        {reminders.length > 0 && (
          <div className="coach-part">
            <div className="field-label">To do</div>
            <ul className="todos">
              {reminders.map((r) => (
                <li key={r.id}>
                  <label className={`chk todo${r.done_at ? " done" : ""}`}>
                    <input type="checkbox" checked={!!r.done_at} onChange={(e) => tick(r.id, e.target.checked)} />
                    <span>{r.body}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!goal && !plan && !reminders.length && <p className="cx-hint coach-part">No goal, plan or to-dos from your coach yet.</p>}
      </section>
    </>
  );
}
