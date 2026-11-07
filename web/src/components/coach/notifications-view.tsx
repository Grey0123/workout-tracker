"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLog } from "@/components/log/log-provider";
import * as coach from "@/lib/coach/api";
import { describeGroup, sentence, type Change } from "@/lib/coach/changes";
import type { Person } from "@/lib/people/types";
import { createClient } from "@/lib/supabase/client";
import { when } from "./history-dialog";
import { useChangeContext } from "./use-change-context";

type Item = { key: string; unread: boolean; at: string; text: string; details: string[]; href: string | null; day: string | null };

const NOTE_WORDS: Record<string, string> = {
  reminder: "a reminder",
  goal: "a new goal",
  weekly_plan: "a plan for the week",
  day: "a note on a day",
};

/** The notification centre: coach changes, notes, and connection news. */
export function NotificationsView() {
  const { notes, openDay } = useLog();
  const ctx = useChangeContext();
  const [list, setList] = useState<coach.Notification[] | null>(null);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    coach.loadNotifications().then(
      async (all) => {
        const ids = [...new Set(all.map((n) => n.actor_id).filter((id): id is string => !!id))];
        const { data } = ids.length
          ? await createClient().from("profiles").select("id, username, display_name, account_type").in("id", ids)
          : { data: [] };
        if (!live) return;
        setPeople(new Map(((data ?? []) as Person[]).map((p) => [p.id, p])));
        setList(all);
        if (all.some((n) => !n.read_at)) {
          await coach.markRead().catch(console.error);
          window.dispatchEvent(new Event(coach.NOTIFICATIONS_READ));
        }
      },
      (err) => {
        console.error(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <div className="card loading">Couldn&apos;t load your notifications. Check your connection and try again.</div>;
  if (!list) return <div className="card loading">Loading…</div>;

  const name = (id: string | null) => {
    const p = id ? people.get(id) : undefined;
    if (!p) return "Someone";
    return p.account_type === "coach" ? `Coach ${p.display_name}` : p.display_name;
  };

  // A coach's save writes several rows. Shown as one change, the way it was made.
  const items: Item[] = [];
  const changes = new Map<string, { rows: Change[]; unread: boolean; at: string }>();
  for (const n of list) {
    if (n.type === "coach_change") {
      const change = coach.notificationChange(n);
      const group = changes.get(change.tx);
      if (group) group.rows.push(change);
      else {
        changes.set(change.tx, { rows: [change], unread: !n.read_at, at: n.created_at });
        items.push({ key: change.tx, unread: !n.read_at, at: n.created_at, text: "", details: [], href: null, day: null });
      }
      continue;
    }
    const who = name(n.actor_id);
    const base = { key: n.id, unread: !n.read_at, at: n.created_at, details: [] as string[], day: null };
    const p = n.payload;
    if (n.type === "connection_request") items.push({ ...base, text: `${who} sent you a request`, href: "/people" });
    else if (n.type === "connection_accepted") items.push({ ...base, text: `${who} accepted your request`, href: "/people" });
    else if (n.type === "invite_accepted") items.push({ ...base, text: `${who} joined through your invite link`, href: "/people" });
    else if (n.type === "connection_ended") items.push({ ...base, text: `${who} ended your connection`, href: "/people" });
    else if (n.type === "coach_removed")
      items.push({ ...base, text: p.replaced ? `${who} chose another coach, so you're no longer connected` : `${who} removed you as their coach`, href: "/people" });
    else if (n.type === "coach_access_changed")
      items.push({ ...base, text: `${who} gave you ${p.access === "full" ? "Full control" : "Add & edit"}`, href: "/clients" });
    else if (n.type === "coach_note") {
      const note = notes.find((x) => x.id === p.row_id);
      items.push({ ...base, text: `${who} sent you ${note ? NOTE_WORDS[note.kind] ?? "a note" : "a note"}`, details: note ? [note.body] : [], href: "/" });
    } else if (n.type === "evaluation") items.push({ ...base, text: `${who} wrote you an evaluation`, href: "/progress" });
  }
  for (const item of items) {
    const group = changes.get(item.key);
    if (!group) continue;
    const lines = describeGroup(group.rows, ctx);
    const first = lines[0];
    item.text = first ? sentence(name(group.rows[0].changed_by), first) : `${name(group.rows[0].changed_by)} changed your log`;
    item.details = first && first.details.length > 1 ? first.details : [];
    item.day = first?.date ?? null;
    item.href = "/calendar";
  }

  if (!items.length) return <div className="card no-entries">Nothing yet. Changes your coach makes, notes and requests show up here.</div>;

  return (
    <>
      <h1 className="section page-heading">Notifications</h1>
      <ul className="card changes notifications">
        {items.map((item) => (
          <li key={item.key} className={`change${item.unread ? " unread" : ""}`}>
            <div className="change-body">{item.text}</div>
            {item.details.length > 0 && (
              <ul>
                {item.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <div className="change-foot">
              <span className="cx-hint">{when(item.at)}</span>
              {item.href && (
                <Link href={item.href} className="link-btn" onClick={() => item.day && openDay(item.day)}>
                  {item.day ? "Open day" : "Open"}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
