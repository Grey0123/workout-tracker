"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/calendar", label: "Calendar" },
  { href: "/progress", label: "Progress" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
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
        <nav aria-label="Main">
          {TABS.map(({ href, label }) => (
            <Link key={href} href={href} className={pathname === href ? "active" : ""} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
    </div>
  );
}
