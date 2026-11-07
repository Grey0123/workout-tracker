"use client";

import Link from "next/link";
import { useState } from "react";
import { SignOutButton } from "@/components/auth-form";
import { dateOf, longDate, niceDate, todayKey, weekOf } from "@/lib/log/dates";
import { entriesSets, entriesVolume, fmtVolume, plural } from "@/lib/log/sets";
import { Activities } from "./activities";
import { CountUp } from "./count-up";
import { useLog } from "./log-provider";

function SessionCard({ day }: { day: string }) {
  const { byDate, mealsByDate, openDay, assistedIds } = useLog();
  const [open, setOpen] = useState(false);
  const entries = byDate.get(day) ?? [];
  const meals = Object.keys(mealsByDate.get(day) ?? {}).length;
  const meta = [plural(entriesSets(entries), "set"), `${fmtVolume(entriesVolume(entries, assistedIds))} kg`];
  if (meals) meta.push(plural(meals, "meal"));

  return (
    <div className={`card session-x${open ? " open" : ""}`}>
      <button type="button" className="sx-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="when">
          {niceDate(day, { month: "short" })}
          <b>{dateOf(day).getDate()}</b>
          {niceDate(day, { weekday: "short" })}
        </span>
        <span className="sx-info">
          <span className="sx-title">{plural(entries.length, "exercise")}</span>
          <span className="sx-meta">{meta.join(" · ")}</span>
        </span>
        <span className="sx-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="sx-body">
          <Activities entries={entries} />
          {meals > 0 && <div className="sx-meals">{plural(meals, "meal")} logged this day</div>}
          <Link href="/calendar" className="btn ghost sm sx-open" onClick={() => openDay(day)}>
            Open day in calendar →
          </Link>
        </div>
      )}
    </div>
  );
}

export function HomeView() {
  const { byDate, mealsByDate, trainedDays, openDay, profile, assistedIds } = useLog();
  const today = todayKey();
  const todayRows = byDate.get(today) ?? [];
  const todayMeals = Object.keys(mealsByDate.get(today) ?? {}).length;

  const week = weekOf(today);
  const weekRows = week.flatMap((day) => byDate.get(day) ?? []);
  const workouts = week.filter((day) => byDate.has(day)).length;
  const thisMonth = trainedDays.filter((day) => day.startsWith(today.slice(0, 7))).length;
  const recent = [...trainedDays].reverse().slice(0, 6);

  return (
    <>
      <section className="card today-bar" aria-label="Today">
        <div className="grow">
          <h1 className="date">{longDate(today)}</h1>
          <div className="top">
            <span className={`pill${todayRows.length ? " done" : ""}`}>
              {todayRows.length ? `✓ ${plural(todayRows.length, "exercise")} · ${plural(entriesSets(todayRows), "set")}` : "no workout yet today"}
            </span>
            <span className={`pill${todayMeals ? " blue" : ""}`}>
              {todayMeals ? `✓ ${todayMeals} of 3 meals logged` : "no meals logged today"}
            </span>
          </div>
        </div>
        <div className="today-actions">
          <Link href="/calendar" className="btn" onClick={() => openDay(today, "workout")}>
            Log workout
          </Link>
          <Link href="/calendar" className="btn ghost" onClick={() => openDay(today, "food")}>
            Log meal
          </Link>
        </div>
      </section>

      <h2 className="section">This week</h2>
      <div className="stats">
        <div className="card stat">
          <div className="num">
            <CountUp value={workouts} />
          </div>
          <div className="lbl">Workouts</div>
        </div>
        <div className="card stat">
          <div className="num">
            <CountUp value={entriesSets(weekRows)} />
          </div>
          <div className="lbl">Total sets</div>
        </div>
        <div className="card stat">
          <div className="num">
            <CountUp value={entriesVolume(weekRows, assistedIds)} format={fmtVolume} />
            <small> kg</small>
          </div>
          <div className="lbl">Volume lifted</div>
        </div>
        <div className="card stat">
          <div className="num">
            <CountUp value={thisMonth} />
          </div>
          <div className="lbl">This month</div>
        </div>
      </div>

      <h2 className="section">Recent sessions</h2>
      <div className="sessions">
        {recent.length ? (
          recent.map((day) => <SessionCard key={day} day={day} />)
        ) : (
          <div className="card no-entries">No sessions yet. Tap a day in the calendar to log your first workout.</div>
        )}
      </div>

      <h2 className="section">Account</h2>
      <section className="card account">
        <div>
          <div className="account-name">{profile.display_name}</div>
          <div className="account-meta">
            @{profile.username} · {profile.account_type === "coach" ? "Coach account" : "User account"}
          </div>
        </div>
        <SignOutButton />
      </section>
    </>
  );
}
