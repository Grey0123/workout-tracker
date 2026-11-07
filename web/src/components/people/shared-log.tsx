"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogProvider, useLog } from "@/components/log/log-provider";
import { COACH_LABEL } from "@/lib/people/types";
import { Avatar } from "./bits";

function SharedHeader() {
  const { profile, connection, basePath } = useLog();
  const pathname = usePathname();
  const isCoach = connection?.kind === "coach";
  const tabs = [
    { href: basePath, label: "Overview" },
    { href: `${basePath}/calendar`, label: "Calendar" },
    { href: `${basePath}/progress`, label: "Progress" },
    ...(isCoach ? [{ href: `${basePath}/notes`, label: "Notes" }] : []),
  ];
  return (
    <section className="card shared-head" aria-label={`${profile.display_name}'s log`}>
      <div className="shared-who">
        <Avatar person={profile} />
        <div className="person-text">
          <div className="person-name">{profile.display_name}&apos;s log</div>
          <div className="person-meta">
            @{profile.username} · {isCoach ? "Your client" : "Shared with you · read only"}
          </div>
          {profile.account_type === "coach" && <div className="person-meta coach-label">{COACH_LABEL}</div>}
        </div>
        <Link href={isCoach ? "/clients" : "/people"} className="shared-back">
          {isCoach ? "Clients" : "People"}
        </Link>
      </div>
      <nav className={`shared-tabs${isCoach ? " four" : ""}`} aria-label={`${profile.display_name}'s log`}>
        {tabs.map(({ href, label }) => (
          <Link key={href} href={href} className={pathname === href ? "active" : ""} aria-current={pathname === href ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
    </section>
  );
}

/** Someone else's Home, Calendar and Progress, read only. The database decides what's in them. */
export function SharedLog({ children }: { children: ReactNode }) {
  const { username } = useParams<{ username: string }>();
  return (
    <LogProvider key={username} username={username}>
      <SharedHeader />
      {children}
    </LogProvider>
  );
}
