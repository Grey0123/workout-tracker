"use client";

import { useState } from "react";
import {
  fmtKg,
  fmtTime,
  fmtVolume,
  setDetail,
  setLabels,
  setsSummary,
  setsVolume,
  topWeight,
  totalReps,
  totalTime,
  weightSummary,
} from "@/lib/log/sets";
import type { Entry } from "@/lib/log/types";
import { EntryVideos } from "@/components/progress/videos";
import { useLog } from "./log-provider";

const TEMPO_HELP = "Seconds: lowering · pause at the bottom · lifting · pause at the top. X means as fast as possible.";

type Handlers = {
  onEdit?: (entry: Entry) => void;
  onDelete?: (entry: Entry, name: string) => void;
  onHistory?: (entry: Entry, name: string) => void;
};

/** PRD 5.3: entries say who added or last edited them, when that wasn't the owner. */
export function useByLine(row: { created_by?: string | null; updated_by?: string | null; updated_at?: string }): string | null {
  const { profile, actorLabel } = useLog();
  const added = row.created_by && row.created_by !== profile.id;
  const edited = row.updated_by && row.updated_by !== profile.id && row.updated_by !== row.created_by;
  if (edited) {
    const at = row.updated_at ? new Date(row.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `Edited by ${actorLabel(row.updated_by)}${at ? ` · ${at}` : ""}`;
  }
  if (added) return `Added by ${actorLabel(row.created_by)}`;
  return null;
}

function Activity({ entry, onEdit, onDelete, onHistory }: { entry: Entry } & Handlers) {
  const { exercises } = useLog();
  const byLine = useByLine(entry);
  const [open, setOpen] = useState(false);
  const exercise = exercises.find((e) => e.id === entry.exercise_id);
  const name = exercise?.name ?? "Unknown exercise";
  const kind = exercise?.kind ?? "weighted";
  const assisted = !!exercise?.assisted;
  const labels = setLabels(entry.sets);

  const meta: string[] = [];
  const helped = entry.sets.map((s) => s.weight_kg ?? 0).filter((w) => w > 0);
  if (assisted && helped.length) {
    meta.push(`least assistance ${fmtKg(Math.min(...helped))} kg`);
  } else if (topWeight(entry.sets) > 0) {
    meta.push(`Volume ${fmtVolume(setsVolume(entry.sets))} kg`, `top set ${fmtKg(topWeight(entry.sets))} kg`);
  }
  if (totalReps(entry.sets)) meta.push(`${totalReps(entry.sets)} total reps`);
  if (totalTime(entry.sets)) meta.push(`${fmtTime(totalTime(entry.sets))} total`);

  return (
    <div className={`activity${open ? " open" : ""}`}>
      <button type="button" className="act-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="act-main">
          <span className="act-name">
            {name}
            {entry.variant && <span className="variant"> · {entry.variant}</span>}
          </span>
          {entry.tempo && (
            <span className="tempo-tag" title={TEMPO_HELP}>
              Tempo {entry.tempo}
            </span>
          )}
          {entry.notes && <span className="act-note">{entry.notes}</span>}
          {byLine && <span className="by-tag">{byLine}</span>}
          {entry.saving && <span className="act-saving">Saving…</span>}
        </span>
        <span className="act-figs">
          <b>{setsSummary(entry.sets)}</b>
          <small>{weightSummary(entry.sets, kind, assisted)}</small>
        </span>
        <span className="act-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="act-body">
          <div className="set-table">
            {entry.sets.map((set, i) => (
              <div className="set-row" key={i}>
                <span className="set-n">{labels[i]}</span>
                <span className="set-w">
                  {set.weight_kg ? `${fmtKg(set.weight_kg)} kg` : kind === "cardio" || kind === "session" ? "" : "BW"}
                  {set.weight_kg && assisted ? <small> assist</small> : null}
                </span>
                <span className="set-r">
                  {setDetail(set)}
                  {set.tempo && <small title={TEMPO_HELP}> · {set.tempo}</small>}
                </span>
              </div>
            ))}
          </div>
          {meta.length > 0 && <div className="act-meta">{meta.join(" · ")}</div>}
          <EntryVideos entry={entry} name={name} canAdd={!!(onEdit || onDelete)} />
          {(onEdit || onDelete || onHistory) && !entry.saving && (
            <div className="act-actions">
              {onEdit && (
                <button type="button" className="btn ghost sm" onClick={() => onEdit(entry)}>
                  Edit
                </button>
              )}
              {onHistory && (
                <button type="button" className="btn ghost sm" onClick={() => onHistory(entry, name)}>
                  History
                </button>
              )}
              {onDelete && (
                <button type="button" className="btn ghost sm danger" onClick={() => onDelete(entry, name)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A day's exercises. Without handlers the list is read-only. */
export function Activities({ entries, ...handlers }: { entries: Entry[] } & Handlers) {
  if (!entries.length) return <div className="no-entries">No workout logged for this day.</div>;
  return (
    <>
      {entries.map((entry) => (
        <Activity key={entry.id} entry={entry} {...handlers} />
      ))}
    </>
  );
}
