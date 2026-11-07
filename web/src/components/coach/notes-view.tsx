"use client";

import { useState, type FormEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import * as coach from "@/lib/coach/api";
import { dayMonth, todayKey, weekOf } from "@/lib/log/dates";
import { when } from "./history-dialog";

type Filter = "all" | "private" | "sent";

const label = (kind: coach.NoteKind) => coach.NOTE_KINDS.find((k) => k.value === kind)!.label;

/** A coach's notes on one client: private ones, and ones sent to them (PRD 5.3). */
export function NotesView() {
  const { connection, profile, me, notes, setNotes, toast } = useLog();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<coach.Note | null>(null);
  const [kind, setKind] = useState<coach.NoteKind>("private");
  const [body, setBody] = useState("");
  const [date, setDate] = useState(todayKey());
  const [busy, setBusy] = useState(false);

  if (connection?.kind !== "coach") {
    return <div className="card no-entries">Notes are kept by {profile.display_name}&apos;s coach.</div>;
  }

  const reset = () => {
    setEditing(null);
    setKind("private");
    setBody("");
    setDate(todayKey());
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const saved = await coach.saveNote(me.id, profile.id, editing?.id ?? null, {
        kind,
        body: body.trim(),
        date: kind === "day" ? date : null,
        week_start: kind === "weekly_plan" ? weekOf(date)[0] : null,
      });
      setNotes((list) => [saved, ...list.filter((n) => n.id !== saved.id)]);
      toast(kind === "private" ? "Note saved" : editing ? "Note updated" : `Sent to ${profile.display_name}`);
      reset();
    } catch (err) {
      console.error(err);
      toast("Couldn't save that note. Check your connection.", "err");
    }
    setBusy(false);
  }

  async function remove(note: coach.Note) {
    if (!confirm(note.kind === "private" ? "Delete this private note?" : `Delete this note? ${profile.display_name} won't see it any more.`)) return;
    setNotes((list) => list.filter((n) => n.id !== note.id));
    try {
      await coach.deleteNote(note.id);
      toast("Note deleted");
    } catch (err) {
      console.error(err);
      setNotes((list) => [note, ...list]);
      toast("Couldn't delete that note.", "err");
    }
  }

  const shown = notes.filter((n) => filter === "all" || (filter === "private") === (n.kind === "private"));

  return (
    <>
      <form className="card note-form" onSubmit={save}>
        <div className="form-title">{editing ? "Edit note" : "New note"}</div>
        <div className="note-kinds" role="radiogroup" aria-label="Kind of note">
          {coach.NOTE_KINDS.map((k) => (
            <label key={k.value} className={`access-option${kind === k.value ? " on" : ""}`}>
              <input type="radio" name="note-kind" checked={kind === k.value} onChange={() => setKind(k.value)} />
              <span>
                <b>{k.label}</b>
                <small>{k.detail}</small>
              </span>
            </label>
          ))}
        </div>
        {(kind === "day" || kind === "weekly_plan") && (
          <div className="ffield">
            <label htmlFor="note-date">{kind === "day" ? "Day" : "Any day in the week"}</label>
            <input id="note-date" type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
        <div className="ffield">
          <label htmlFor="note-body">Note</label>
          <textarea id="note-body" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
        </div>
        <button type="submit" className="save-btn" disabled={busy || !body.trim()}>
          {busy ? "Saving…" : kind === "private" ? "Save note" : editing ? "Update note" : `Send to ${profile.display_name}`}
        </button>
        {editing && (
          <button type="button" className="btn ghost block note-cancel" onClick={reset}>
            Cancel
          </button>
        )}
      </form>

      <div className="seg note-filter" role="group" aria-label="Show">
        {(
          [
            ["all", "All"],
            ["private", "Private"],
            ["sent", `Sent to ${profile.display_name}`],
          ] as const
        ).map(([value, text]) => (
          <button type="button" key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {text}
          </button>
        ))}
      </div>

      <div className="people-list">
        {shown.length ? (
          shown.map((n) => (
            <article className="card note" key={n.id}>
              <div className="note-head">
                <span className={`note-kind${n.kind === "private" ? " private" : ""}`}>
                  {n.kind === "private" ? "Private · only you" : label(n.kind)}
                </span>
                <span className="cx-hint">
                  {n.kind === "day" && n.date ? `For ${dayMonth(n.date)} · ` : ""}
                  {n.kind === "weekly_plan" && n.week_start ? `Week of ${dayMonth(n.week_start)} · ` : ""}
                  {when(n.created_at)}
                </span>
                {n.kind === "reminder" && <span className={`note-done${n.done_at ? " done" : ""}`}>{n.done_at ? `✓ Done by ${profile.display_name}` : "Open"}</span>}
              </div>
              <p>{n.body}</p>
              <div className="card-actions">
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => {
                    setEditing(n);
                    setKind(n.kind);
                    setBody(n.body);
                    setDate(n.date ?? n.week_start ?? todayKey());
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Edit
                </button>
                <button type="button" className="btn ghost sm danger" onClick={() => remove(n)}>
                  Delete
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="card no-entries">No notes here yet.</div>
        )}
      </div>
      <p className="cx-hint disclaimer-line">
        Coach accounts are self-declared. WorkoutTracker doesn&apos;t verify qualifications, and nothing here is medical or
        nutrition advice.
      </p>
    </>
  );
}
