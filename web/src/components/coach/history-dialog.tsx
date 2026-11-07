"use client";

import { useEffect, useState } from "react";
import { useLog } from "@/components/log/log-provider";
import { Modal } from "@/components/people/bits";
import * as coach from "@/lib/coach/api";
import { describeGroup, groupByTx, type Change } from "@/lib/coach/changes";
import { useChangeContext } from "./use-change-context";

export type HistoryTarget = { table: "session_exercises" | "meals"; id: string; title: string };

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** One change: who made it, when, and what it did. Undo is for the owner, on other people's changes. */
export function ChangeItem({ group, onUndone }: { group: Change[]; onUndone?: () => void }) {
  const { actorLabel, isOwn, me, toast, reload } = useLog();
  const ctx = useChangeContext();
  const [busy, setBusy] = useState(false);
  const by = group[0].changed_by;
  const lines = describeGroup(group, ctx);
  if (!lines.length) return null;

  async function undo() {
    setBusy(true);
    try {
      await coach.undoChanges(group.map((c) => c.id));
      toast("Undone");
      reload();
      onUndone?.();
    } catch (err) {
      console.error(err);
      toast(coach.undoError(err), "err");
    }
    setBusy(false);
  }

  return (
    <li className="change">
      <div className="change-head">
        <b>{actorLabel(by)}</b>
        <span>{when(group[0].changed_at)}</span>
      </div>
      {lines.map((d, i) => (
        <div key={i} className="change-body">
          <div>{d.what}</div>
          {d.details.length > 0 && (
            <ul>
              {d.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {isOwn && by && by !== me.id && (
        <button type="button" className="btn ghost sm undo-btn" disabled={busy} onClick={undo}>
          {busy ? "Undoing…" : "Undo this change"}
        </button>
      )}
    </li>
  );
}

/** Everything that happened to one entry, newest first (PRD 5.3: before → after, who, when). */
export function HistoryDialog({ target, onClose }: { target: HistoryTarget; onClose: () => void }) {
  const [groups, setGroups] = useState<Change[][] | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    coach.loadHistory(target.table, target.id).then(
      (rows) => live && setGroups(groupByTx(rows)),
      (err) => {
        console.error(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [target.table, target.id, version]);

  return (
    <Modal title={`History · ${target.title}`} onClose={onClose}>
      {failed ? (
        <p className="status err">Couldn&apos;t load the history. Check your connection and try again.</p>
      ) : !groups ? (
        <p className="cx-hint">Loading…</p>
      ) : groups.length ? (
        <ul className="changes">
          {groups.map((g) => (
            <ChangeItem key={g[0].tx} group={g} onUndone={() => setVersion((n) => n + 1)} />
          ))}
        </ul>
      ) : (
        <p className="cx-hint">No changes recorded. Entries brought over from v1 start without a history.</p>
      )}
    </Modal>
  );
}
