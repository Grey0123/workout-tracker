"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

/** Someone else's log, and invites, belong under People. */
const TABS = [
  { href: "/", label: "Home", matches: (path: string) => path === "/" },
  { href: "/calendar", label: "Calendar", matches: (path: string) => path === "/calendar" },
  { href: "/progress", label: "Progress", matches: (path: string) => path === "/progress" },
  { href: "/people", label: "People", matches: (path: string) => /^\/(people|u|invite)(\/|$)/.test(path) },
] as const;

function Tabs({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main">
      {TABS.map(({ href, label, matches }) => {
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

function CurrentTabs() {
  return <Tabs pathname={usePathname()} />;
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
          <span className="role-tag">My log</span>
        </div>
        {/* On pages with a username in the address, the path is only known per
            request, so the tabs render without a highlight until it is. */}
        <Suspense fallback={<Tabs pathname={null} />}>
          <CurrentTabs />
        </Suspense>
      </header>
    </div>
  );
}
