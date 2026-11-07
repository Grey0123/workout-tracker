"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { NOTIFICATIONS_READ, unreadCount } from "@/lib/coach/api";
import { createClient } from "@/lib/supabase/client";
import { supabaseEnv } from "@/lib/supabase/env";

/** Someone else's log, and invites, belong under People. Coaches also get Clients. */
const TABS: { href: string; label: string; matches: (path: string) => boolean; coachOnly?: boolean }[] = [
  { href: "/", label: "Home", matches: (path) => path === "/" },
  { href: "/calendar", label: "Calendar", matches: (path) => path === "/calendar" },
  { href: "/progress", label: "Progress", matches: (path) => path === "/progress" },
  { href: "/clients", label: "Clients", matches: (path) => path === "/clients", coachOnly: true },
  { href: "/people", label: "People", matches: (path) => /^\/(people|u|invite)(\/|$)/.test(path) },
];

type HeaderInfo = { coach: boolean; unread: number };
const NO_INFO: HeaderInfo = { coach: false, unread: 0 };

/** Account type and unread count, refreshed on every move and when notifications are read. */
function useHeaderInfo(pathname: string): HeaderInfo {
  const [info, setInfo] = useState<HeaderInfo>(NO_INFO);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    window.addEventListener(NOTIFICATIONS_READ, bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener(NOTIFICATIONS_READ, bump);
      window.removeEventListener("focus", bump);
    };
  }, []);

  useEffect(() => {
    if (!supabaseEnv()) return;
    let live = true;
    const db = createClient();
    db.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || !live) return;
      const [{ data: profile }, unread] = await Promise.all([
        db.from("profiles").select("account_type").eq("id", user.id).maybeSingle(),
        unreadCount().catch(() => 0),
      ]);
      if (live) setInfo({ coach: profile?.account_type === "coach", unread });
    });
    return () => {
      live = false;
    };
  }, [pathname, version]);
  return info;
}

function Tabs({ pathname, info }: { pathname: string | null; info: HeaderInfo }) {
  const tabs = TABS.filter((t) => !t.coachOnly || info.coach);
  return (
    <nav aria-label="Main" className={tabs.length === 5 ? "tabs-5" : undefined}>
      {tabs.map(({ href, label, matches }) => {
        const active = pathname !== null && matches(pathname);
        return (
          <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Bell({ info, pathname }: { info: HeaderInfo; pathname: string | null }) {
  return (
    <Link
      href="/notifications"
      className={`bell${pathname === "/notifications" ? " active" : ""}`}
      aria-label={info.unread ? `Notifications, ${info.unread} unread` : "Notifications"}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {info.unread > 0 && <span className="bell-count">{info.unread > 99 ? "99+" : info.unread}</span>}
    </Link>
  );
}

/** Reads the path, so it waits for it on pages with a username in the address. */
function CurrentNav({ part }: { part: "tabs" | "bell" }) {
  const pathname = usePathname();
  const info = useHeaderInfo(pathname);
  return part === "tabs" ? <Tabs pathname={pathname} info={info} /> : <Bell info={info} pathname={pathname} />;
}

export function AppHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const apply = () => {
      ticking = false;
      // Two thresholds so the reflow from collapsing can't flicker.
      if (window.scrollY > 80) setScrolled(true);
      else if (window.scrollY < 30) setScrolled(false);
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={`site-head${scrolled ? " scrolled" : ""}`}>
      <header>
        <div className="brand">
          <div className="brand-name">
            Workout<span>Tracker</span>
          </div>
          <div className="brand-side">
            <span className="role-tag">My log</span>
            <Suspense fallback={<Bell info={NO_INFO} pathname={null} />}>
              <CurrentNav part="bell" />
            </Suspense>
          </div>
        </div>
        {/* On pages with a username in the address, the path is only known per
            request, so the tabs render without a highlight until it is. */}
        <Suspense fallback={<Tabs pathname={null} info={NO_INFO} />}>
          <CurrentNav part="tabs" />
        </Suspense>
      </header>
    </div>
  );
}
