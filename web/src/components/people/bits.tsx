"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { COACH_LABEL, SHARE_OPTIONS, type ConnectionKind, type Person, type Shares } from "@/lib/people/types";

export function Avatar({ person }: { person: Pick<Person, "display_name"> }) {
  const initials = person.display_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="avatar" aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

/** Name, username, and for coaches the self-declared label (PRD 4.1). */
export function PersonLine({ person, showCoach = true, children }: { person: Person; showCoach?: boolean; children?: ReactNode }) {
  return (
    <div className="person">
      <Avatar person={person} />
      <div className="person-text">
        <div className="person-name">{person.display_name}</div>
        <div className="person-meta">
          @{person.username}
          {person.account_type === "coach" && showCoach && <span className="coach-label"> · {COACH_LABEL}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Switches for what one connection sees. Meal photos need meals on. */
export function ShareToggles({ value, onChange, disabled }: { value: Shares; onChange: (change: Partial<Shares>) => void; disabled?: boolean }) {
  return (
    <div className="share-toggles">
      {SHARE_OPTIONS.map(({ key, label, needs }) => {
        const blocked = !!needs && !value[needs];
        return (
          <label key={key} className={`share-toggle${blocked ? " blocked" : ""}`}>
            <span>{label}</span>
            <input
              type="checkbox"
              role="switch"
              checked={value[key] && !blocked}
              disabled={disabled || blocked}
              onChange={(e) =>
                onChange(key === "share_meals" && !e.target.checked ? { share_meals: false, share_meal_photos: false } : { [key]: e.target.checked })
              }
            />
          </label>
        );
      })}
    </div>
  );
}

/** What a coach can do once connected, shown before anyone accepts one (PRD 4.1). */
export function CoachNotice({ coachName, accepted, onAccept }: { coachName: string; accepted: boolean; onAccept: (v: boolean) => void }) {
  return (
    <div className="coach-notice">
      <p>
        <b>{coachName}</b> is a self-declared coach. WorkoutTracker doesn&apos;t verify or certify coaches, or check
        their qualifications.
      </p>
      <ul>
        <li>They&apos;ll see what you share below.</li>
        <li>They can add and change your workouts and meals. You&apos;ll be told about every change.</li>
        <li>They can keep private notes about you and send you notes and reminders.</li>
        <li>They can&apos;t delete anything unless you give them Full control later.</li>
      </ul>
      <label className="chk">
        <input type="checkbox" checked={accepted} onChange={(e) => onAccept(e.target.checked)} />I understand
      </label>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="modal" aria-labelledby="modal-title" onClose={onClose}>
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

/** How a connection reads to one of its two people. */
export function describe(kind: ConnectionKind, iAmOwner: boolean, theyAsked: boolean): string {
  if (kind === "coach") {
    if (theyAsked) return iAmOwner ? "wants to coach you" : "asks you to be their coach";
    return iAmOwner ? "You asked them to coach you" : "You offered to coach them";
  }
  if (theyAsked) return iAmOwner ? "asks to see your log" : "wants to share their log with you";
  return iAmOwner ? "You offered to share your log" : "You asked to see their log";
}
