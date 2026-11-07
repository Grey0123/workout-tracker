"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import * as coach from "@/lib/coach/api";
import { describeGroup, groupByTx, sentence, type Change } from "@/lib/coach/changes";
import { todayKey, weekOf } from "@/lib/log/dates";
import { SHARE_OPTIONS } from "@/lib/people/types";
import { when } from "./history-dialog";
import { useChangeContext } from "./use-change-context";

/** Edit a pinned note in place: the current goal, or this week's plan. */
function PinnedNote({ kind, label, note }: { kind: "goal" | "weekly_plan"; label: string; note: coach.Note | undefined }) {
  const { me, profile, setNotes, toast } = useLog();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note?.body ?? "");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      // A new goal or plan replaces what's pinned, so it notifies the client like any sent note.
      const saved = await coach.saveNote(me.id, profile.id, note?.id ?? null, {
        kind,
        body: text.trim(),
        date: null,
        week_start: kind === "weekly_plan" ? weekOf(todayKey())[0] : null,
      });
      setNotes((list) => [saved, ...list.filter((n) => n.id !== saved.id)]);
      toast(`${label} saved`);
      setEditing(false);
    } catch (err) {
      console.error(err);
      toast("Couldn't save that. Check your connection.", "err");
    }
    setBusy(false);
  }

  return (
    <div className="coach-part">
      <div className="pinned-head">
        <span className="field-label">{label}</span>
        {!editing && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setText(note?.body ?? "");
              setEditing(true);
            }}
          >
            {note ? "Edit" : "Add"}
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="pinned-form">
          <textarea
            aria-label={label}
            value={text}
            maxLength={2000}
            placeholder={kind === "goal" ? "Bench Press 80 kg by December" : "Push / Pull / Legs × 2, focus on bench lockout"}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="card-actions">
            <button type="submit" className="btn sm" disabled={busy || !text.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : note ? (
        <div className={kind === "goal" ? "coach-goal" : "coach-plan"}>{note.body}</div>
      ) : (
        <div className="cx-hint">{kind === "goal" ? "No goal set." : "No plan for this week."}</div>
      )}
    </div>
  );
}

/** What a coach sees above a client's Home (design: Coach · Client page). */
export function CoachPanel() {
  const { profile, connection, notes, me, basePath, openDay } = useLog();
  const ctx = useChangeContext();
  const [changes, setChanges] = useState<Change[][] | null>(null);
  const c = connection!;
  const full = c.coach_access === "full";

  useEffect(() => {
    let live = true;
    coach.loadMyChanges(me.id, profile.id).then(
      (rows) => live && setChanges(groupByTx(rows).slice(0, 6)),
      (err) => console.error(err),
    );
    return () => {
      live = false;
    };
  }, [me.id, profile.id]);

  return (
    <>
      <section className="card client-access" aria-label="Your access">
        <div className="coach-part">
          <div className="person-name">Access: {full ? "Full control" : "Add & edit"}</div>
          <div className="cx-hint">
            {profile.display_name} chose this level.{" "}
            {full
              ? "You can add, edit and delete their entries. They can restore anything you delete."
              : "You can add and edit their entries, but not delete them."}
          </div>
        </div>
        <div className="coach-part">
          <div className="field-label">Shared with you</div>
          <div className="share-chips">
            {SHARE_OPTIONS.map(({ key, label }) => (
              <span key={key} className={`share-chip${c[key] ? " on" : ""}`}>
                {c[key] ? `✓ ${label}` : `${label}: not shared`}
              </span>
            ))}
          </div>
        </div>
        <div className="card-actions coach-part">
          {(c.share_workouts || c.share_meals) && (
            <Link href={`${basePath}/calendar`} className="btn sm" onClick={() => openDay(todayKey(), c.share_workouts ? "workout" : "food")}>
              Log for {profile.display_name}
            </Link>
          )}
          <Link href={`${basePath}/notes`} className="btn ghost sm">
            Notes
          </Link>
        </div>
      </section>

      <h2 className="section">Pinned for {profile.display_name}</h2>
      <section className="card coach-card">
        <PinnedNote kind="goal" label="Current goal" note={coach.currentGoal(notes)} />
        <PinnedNote kind="weekly_plan" label="This week's plan" note={coach.planFor(notes, todayKey())} />
      </section>

      {changes && changes.length > 0 && (
        <>
          <h2 className="section">Your recent changes</h2>
          <ul className="card changes my-changes">
            {changes.flatMap((group) =>
              describeGroup(group, ctx).map((d, i) => (
                <li className="change" key={`${group[0].tx}-${i}`}>
                  <div className="change-body">{sentence("You", d)}</div>
                  <div className="cx-hint">
                    {when(group[0].changed_at)} · {profile.display_name} was notified
                  </div>
                </li>
              )),
            )}
          </ul>
        </>
      )}

      <h2 className="section">{profile.display_name}&apos;s log</h2>
    </>
  );
}
