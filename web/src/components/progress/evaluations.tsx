"use client";

import { useState, type FormEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import { Avatar, Modal } from "@/components/people/bits";
import { fmtSet } from "@/lib/coach/changes";
import { dayMonth, dayMonthYear, todayKey } from "@/lib/log/dates";
import type { SetValues } from "@/lib/log/types";
import * as progress from "@/lib/progress/api";
import { recap, recapLines, type Pr, type Range } from "@/lib/progress/calc";

const RATINGS = [
  { key: "rating_training", label: "Training" },
  { key: "rating_nutrition", label: "Nutrition" },
  { key: "rating_consistency", label: "Consistency" },
] as const;

type Draft = { id: string | null; range: Range; feedback: string };

function Ratings({ evaluation }: { evaluation: progress.Evaluation }) {
  const rated = RATINGS.filter(({ key }) => evaluation[key] !== null);
  if (!rated.length) return null;
  return (
    <div className="ratings">
      {rated.map(({ key, label }) => (
        <div className="rating" key={key}>
          <span>{label}</span>
          <span className="rating-bar" role="img" aria-label={`${label}: ${evaluation[key]} out of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={n <= evaluation[key]! ? "on" : ""} />
            ))}
          </span>
          <span className="rating-score">{evaluation[key]}/5</span>
        </div>
      ))}
    </div>
  );
}

function EvaluationCard({ evaluation, onEdit, onDelete }: { evaluation: progress.Evaluation; onEdit?: () => void; onDelete?: () => void }) {
  const { actorLabel, actors } = useLog();
  const coachPerson = actors.find((p) => p.id === evaluation.coach_id);
  return (
    <article className="card evaluation">
      <div className="evaluation-head">
        <Avatar person={coachPerson ?? { display_name: actorLabel(evaluation.coach_id) }} />
        <div className="person-text">
          <div className="person-name">
            {actorLabel(evaluation.coach_id)} · {dayMonth(evaluation.created_at.slice(0, 10))}
          </div>
          <div className="person-meta">
            Covers {dayMonth(evaluation.period_start)} – {dayMonthYear(evaluation.period_end)}
          </div>
        </div>
      </div>
      <Ratings evaluation={evaluation} />
      <p className="evaluation-text">{evaluation.feedback}</p>
      {evaluation.next_goals.length > 0 && (
        <div className="next-goals">
          <div className="field-label">Goals for next period</div>
          <ul>
            {evaluation.next_goals.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {(onEdit || onDelete) && (
        <div className="card-actions">
          {onEdit && (
            <button type="button" className="btn ghost sm" onClick={onEdit}>
              Edit
            </button>
          )}
          {onDelete && (
            <button type="button" className="btn ghost sm danger" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function EvaluationForm({ draft, existing, prs, onClose }: { draft: Draft; existing?: progress.Evaluation; prs: Pr[]; onClose: () => void }) {
  const { me, profile, update, toast, entries, meals, weights, assistedIds, exercises } = useLog();
  const [start, setStart] = useState(existing?.period_start ?? draft.range.start);
  const [end, setEnd] = useState(existing?.period_end ?? draft.range.end);
  const [feedback, setFeedback] = useState(existing?.feedback ?? draft.feedback);
  const [goals, setGoals] = useState(existing?.next_goals.join("\n") ?? "");
  const [ratings, setRatings] = useState<Record<string, number | null>>({
    rating_training: existing?.rating_training ?? null,
    rating_nutrition: existing?.rating_nutrition ?? null,
    rating_consistency: existing?.rating_consistency ?? null,
  });
  const [busy, setBusy] = useState(false);

  const fromRecap = () => {
    const lines = recapLines(
      { start: start <= end ? start : end, end: start <= end ? end : start },
      "the period before",
      { entries, meals, weights, prs, assisted: assistedIds, byId: new Map(exercises.map((e) => [e.id, e])), describeSet: (s: SetValues) => fmtSet(s as unknown as Record<string, unknown>) },
      todayKey(),
    );
    setFeedback([feedback.trim(), lines.join("\n")].filter(Boolean).join("\n\n"));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!feedback.trim()) return;
    setBusy(true);
    try {
      const saved = await progress.saveEvaluation(me.id, profile.id, existing?.id ?? null, {
        period_start: start <= end ? start : end,
        period_end: start <= end ? end : start,
        feedback: feedback.trim(),
        rating_training: ratings.rating_training,
        rating_nutrition: ratings.rating_nutrition,
        rating_consistency: ratings.rating_consistency,
        next_goals: goals.split("\n").map((g) => g.trim()).filter(Boolean),
      });
      update((d) => ({
        ...d,
        evaluations: [saved, ...d.evaluations.filter((e) => e.id !== saved.id)].sort((a, b) => b.period_end.localeCompare(a.period_end)),
      }));
      toast(existing ? "Evaluation updated" : `Sent to ${profile.display_name}`);
      onClose();
    } catch (err) {
      console.error(err);
      toast("Couldn't save the evaluation. Check your connection.", "err");
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? "Edit evaluation" : `Evaluate ${profile.display_name}`} onClose={onClose}>
      <form className="evaluation-form" onSubmit={save}>
        <div className="custom-range">
          <label>
            From
            <input type="date" value={start} required onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={end} required onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {RATINGS.map(({ key, label }) => (
          <div className="rate-row" key={key} role="radiogroup" aria-label={`${label}, 1 to 5`}>
            <span>{label}</span>
            <span className="rate-buttons">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={ratings[key] === n}
                  aria-label={`${label} ${n} of 5`}
                  className={ratings[key] !== null && n <= ratings[key]! ? "on" : ""}
                  onClick={() => setRatings({ ...ratings, [key]: ratings[key] === n ? null : n })}
                >
                  {n}
                </button>
              ))}
            </span>
          </div>
        ))}
        <div className="ffield">
          <div className="pinned-head">
            <label htmlFor="eval-feedback">Feedback</label>
            <button type="button" className="link-btn" onClick={fromRecap}>
              Add the recap for these dates
            </button>
          </div>
          <textarea id="eval-feedback" rows={7} value={feedback} maxLength={5000} required onChange={(e) => setFeedback(e.target.value)} />
        </div>
        <div className="ffield">
          <label htmlFor="eval-goals">
            Goals for next period <span className="opt">(one a line)</span>
          </label>
          <textarea id="eval-goals" rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} />
        </div>
        <button type="submit" className="save-btn" disabled={busy || !feedback.trim()}>
          {busy ? "Saving…" : existing ? "Update evaluation" : `Send to ${profile.display_name}`}
        </button>
      </form>
    </Modal>
  );
}

/** Coach evaluations, newest first, and the automatic recaps a coach can start one from. */
export function EvaluationsSection({ range, prs }: { range: Range; prs: Pr[] }) {
  const { evaluations, connection, isOwn, update, toast, entries, meals, weights, assistedIds, exercises, profile } = useLog();
  const isCoach = connection?.kind === "coach";
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState<{ draft: Draft; existing?: progress.Evaluation } | null>(null);
  const [recapKind, setRecapKind] = useState<"week" | "month" | null>(null);
  if (!isOwn && !isCoach) return null;

  const today = todayKey();
  const data = {
    entries,
    meals,
    weights,
    prs,
    assisted: assistedIds,
    byId: new Map(exercises.map((e) => [e.id, e])),
    describeSet: (s: SetValues) => fmtSet(s as unknown as Record<string, unknown>),
  };
  const summary = recapKind ? recap(recapKind, data, today) : null;
  const clip = (r: Range): Range => ({ start: r.start, end: r.end > today ? today : r.end });

  async function remove(evaluation: progress.Evaluation) {
    if (!confirm(`Delete this evaluation? ${profile.display_name} won't see it any more.`)) return;
    update((d) => ({ ...d, evaluations: d.evaluations.filter((e) => e.id !== evaluation.id) }));
    try {
      await progress.deleteEvaluation(evaluation.id);
      toast("Evaluation deleted");
    } catch (err) {
      console.error(err);
      update((d) => ({ ...d, evaluations: [evaluation, ...d.evaluations] }));
      toast("Couldn't delete that evaluation.", "err");
    }
  }

  const shown = showAll ? evaluations : evaluations.slice(0, 1);
  return (
    <>
      <div className="section-row">
        <h2 className="section">Coach evaluation</h2>
        {evaluations.length > 1 && (
          <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Latest only" : `All ${evaluations.length}`}
          </button>
        )}
      </div>
      {isCoach && (
        <button type="button" className="btn block write-evaluation" onClick={() => setForm({ draft: { id: null, range: clip(range), feedback: "" } })}>
          Write evaluation
        </button>
      )}
      <div className="people-list">
        {shown.length ? (
          shown.map((e) => (
            <EvaluationCard
              key={e.id}
              evaluation={e}
              onEdit={isCoach ? () => setForm({ draft: { id: e.id, range: { start: e.period_start, end: e.period_end }, feedback: e.feedback }, existing: e }) : undefined}
              onDelete={isCoach ? () => remove(e) : undefined}
            />
          ))
        ) : (
          <div className="card no-entries">
            {isCoach ? "You haven't written one yet. They can be about any stretch of time." : "No evaluations yet. Your coach can write one whenever they like."}
          </div>
        )}
      </div>

      <div className="recap-buttons">
        <button type="button" className="btn ghost" onClick={() => setRecapKind("week")}>
          Weekly recap
        </button>
        <button type="button" className="btn ghost" onClick={() => setRecapKind("month")}>
          Monthly recap
        </button>
      </div>

      {summary && (
        <Modal title={`${recapKind === "week" ? "Weekly" : "Monthly"} recap · ${summary.title}`} onClose={() => setRecapKind(null)}>
          <ul className="recap-lines">
            {summary.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {isCoach && (
            <button
              type="button"
              className="save-btn"
              onClick={() => {
                setRecapKind(null);
                setForm({ draft: { id: null, range: clip(summary.range), feedback: summary.lines.join("\n") } });
              }}
            >
              Start an evaluation from this
            </button>
          )}
        </Modal>
      )}
      {form && <EvaluationForm draft={form.draft} existing={form.existing} prs={prs} onClose={() => setForm(null)} />}
    </>
  );
}
