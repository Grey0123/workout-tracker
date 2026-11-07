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
import { useLog } from "./log-provider";

const TEMPO_HELP = "Seconds: lowering · pause at the bottom · lifting · pause at the top. X means as fast as possible.";

function Activity({ entry, onEdit, onDelete }: { entry: Entry; onEdit?: (entry: Entry) => void; onDelete?: (entry: Entry, name: string) => void }) {
  const { exercises } = useLog();
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
          {onEdit && onDelete && !entry.saving && (
            <div className="act-actions">
              <button type="button" className="btn ghost sm" onClick={() => onEdit(entry)}>
                Edit
              </button>
              <button type="button" className="btn ghost sm danger" onClick={() => onDelete(entry, name)}>
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A day's exercises. Without onEdit and onDelete the list is read-only. */
export function Activities({
  entries,
  onEdit,
  onDelete,
}: {
  entries: Entry[];
  onEdit?: (entry: Entry) => void;
  onDelete?: (entry: Entry, name: string) => void;
}) {
  if (!entries.length) return <div className="no-entries">No workout logged for this day.</div>;
  return (
    <>
      {entries.map((entry) => (
        <Activity key={entry.id} entry={entry} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </>
  );
}
