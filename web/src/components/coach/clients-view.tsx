"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLog } from "@/components/log/log-provider";
import { Avatar } from "@/components/people/bits";
import * as coach from "@/lib/coach/api";
import { clientStats } from "@/lib/coach/stats";
import { dayMonth, todayKey } from "@/lib/log/dates";
import { plural } from "@/lib/log/sets";

const ago = (days: number | null) => (days === null ? "Never" : days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`);

/** Every client at a glance (PRD 5.3: last workout, this week, streak, and who's gone quiet). */
export function ClientsView() {
  const { me } = useLog();
  const [clients, setClients] = useState<coach.ClientSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (me.account_type !== "coach") return;
    let live = true;
    coach.loadClients(me.id).then(
      (list) => live && setClients(list),
      (err) => {
        console.error(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [me.id, me.account_type]);

  if (me.account_type !== "coach") return <div className="card no-entries">The client list is for coach accounts.</div>;
  if (failed) return <div className="card loading">Couldn&apos;t load your clients. Check your connection and try again.</div>;
  if (!clients) return <div className="card loading">Loading…</div>;
  if (!clients.length) {
    return (
      <div className="card no-entries">
        No clients yet. Invite one from <Link href="/people">People</Link>, or ask them to send you a request.
      </div>
    );
  }

  const today = todayKey();
  const rows = clients
    .map((c) => ({ c, s: clientStats(c.days, today) }))
    .sort((a, b) => Number(b.s.flagged) - Number(a.s.flagged) || (b.s.last ?? "").localeCompare(a.s.last ?? ""));

  return (
    <>
      <h1 className="section page-heading">Your clients</h1>
      <div className="people-list">
        {rows.map(({ c, s }) => (
          <Link key={c.connectionId} href={`/u/${c.person.username}`} className="card client-card">
            <div className="person">
              <Avatar person={c.person} />
              <div className="person-text">
                <div className="person-name">{c.person.display_name}</div>
                <div className="person-meta">
                  @{c.person.username} · client since {dayMonth(c.since.slice(0, 10))} · {c.access === "full" ? "Full control" : "Add & edit"}
                </div>
              </div>
              {s.flagged && c.sharesWorkouts && (
                <span className="pill amber">{s.quiet === null ? "Hasn't logged yet" : `No workout for ${plural(s.quiet, "day")}`}</span>
              )}
            </div>
            {c.sharesWorkouts ? (
              <div className="client-stats">
                <div>
                  <b>{ago(s.quiet)}</b>
                  <small>Last workout</small>
                </div>
                <div>
                  <b>{s.thisWeek}</b>
                  <small>This week</small>
                </div>
                <div>
                  <b>{plural(s.streak, "week")}</b>
                  <small>Streak</small>
                </div>
              </div>
            ) : (
              <p className="cx-hint">{c.person.display_name} isn&apos;t sharing workouts with you.</p>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
