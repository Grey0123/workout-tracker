"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import { dayMonth, keyOf } from "@/lib/log/dates";
import * as api from "@/lib/people/api";
import {
  DEFAULT_SHARES,
  SHARE_OPTIONS,
  type CoachAccess,
  type Connection,
  type ConnectionKind,
  type Invite,
  type Person,
  type Shares,
} from "@/lib/people/types";
import { CoachNotice, describe, Modal, PersonLine, ShareToggles } from "./bits";

/** Something the owner of a log has to confirm: what to share, and for a coach, the notice. */
type OwnerStep = {
  title: string;
  confirm: string;
  person: Person | null;
  kind: ConnectionKind;
  /** Invite links are made before anyone joins, so there's nothing to tick yet. */
  withShares: boolean;
  shares: Shares;
  run: (choices: api.OwnerChoices) => Promise<unknown>;
  done: string;
};

const ACCESS: { value: CoachAccess; title: string; detail: string }[] = [
  { value: "add_edit", title: "Add & edit", detail: "Add and change your workouts and meals. Can't delete anything." },
  { value: "full", title: "Full control", detail: "Also delete workouts and meals. You can restore anything they delete." },
];

const INVITE_LABELS: Record<string, string> = {
  "friend:true": "Shares your log",
  "friend:false": "Asks to see a log",
  "coach:true": "For your coach",
  "coach:false": "Invites a client",
};

const sharedList = (c: Shares) =>
  SHARE_OPTIONS.filter(({ key }) => c[key])
    .map(({ label }) => label.toLowerCase())
    .join(", ") || "nothing at the moment";

function OwnerDialog({ step, coach, onClose }: { step: OwnerStep; coach: Person | null; onClose: (done: boolean) => void }) {
  const { toast } = useLog();
  const [shares, setShares] = useState(step.shares);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCoach = step.kind === "coach";
  const replacing = isCoach && coach && coach.id !== step.person?.id ? coach : null;
  const name = step.person?.display_name ?? "your coach";

  async function confirm() {
    setBusy(true);
    try {
      await step.run({ notice, replace: !!replacing, shares: step.withShares ? shares : undefined });
      toast(step.done);
      onClose(true);
    } catch (err) {
      console.error(err);
      toast(api.friendlyError(err), "err");
      setBusy(false);
    }
  }

  return (
    <Modal title={step.title} onClose={() => onClose(false)}>
      {step.person && <PersonLine person={step.person} />}
      {isCoach && <CoachNotice coachName={step.person ? step.person.display_name : "Whoever opens the link"} accepted={notice} onAccept={setNotice} />}
      {replacing && (
        <p className="replace-warn">
          You can have one coach at a time. This replaces <b>{replacing.display_name}</b>, who loses access when {name} joins.
        </p>
      )}
      {step.withShares ? (
        <>
          <div className="field-label">What they can see</div>
          <ShareToggles value={shares} onChange={(change) => setShares({ ...shares, ...change })} />
          <p className="cx-hint">You can change this any time on this page.</p>
        </>
      ) : (
        <p className="cx-hint">Once they join, you choose what they see on this page.</p>
      )}
      <button type="button" className="save-btn" disabled={busy || (isCoach && !notice)} onClick={confirm}>
        {busy ? "Working…" : step.confirm}
      </button>
    </Modal>
  );
}

function InviteBox({ invite, onCancel }: { invite: Invite; onCancel?: () => void }) {
  const { toast } = useLog();
  const url = api.inviteUrl(invite.code);
  const copy = () =>
    navigator.clipboard?.writeText(url).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy. Select the link and copy it.", "err"),
    );
  return (
    <div className="invite-box">
      <div className="invite-label">
        {INVITE_LABELS[`${invite.kind}:${invite.inviter_shares}`]} · works once · until {dayMonth(keyOf(new Date(invite.expires_at)))}
      </div>
      <input readOnly value={url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
      <div className="invite-actions">
        <button type="button" className="btn ghost sm" onClick={copy}>
          Copy link
        </button>
        {onCancel && (
          <button type="button" className="btn ghost sm danger" onClick={onCancel}>
            Cancel link
          </button>
        )}
      </div>
    </div>
  );
}

export function PeopleView() {
  const { profile: me, toast } = useLog();
  const [data, setData] = useState<api.PeopleData | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [step, setStep] = useState<OwnerStep | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person | null | "none">(null);
  const [newInvite, setNewInvite] = useState<Invite | null>(null);

  useEffect(() => {
    let live = true;
    api.loadPeople(me.id).then(
      (loaded) => live && setData(loaded),
      (err) => {
        console.error(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [me.id, version]);

  const reload = () => setVersion((n) => n + 1);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast(done);
      reload();
    } catch (err) {
      console.error(err);
      toast(api.friendlyError(err), "err");
    }
  }

  if (failed) {
    return (
      <div className="card loading">
        <p>Couldn&apos;t load your connections. Check your connection and try again.</p>
        <button
          type="button"
          className="btn ghost"
          style={{ marginTop: 12 }}
          onClick={() => {
            setFailed(false);
            reload();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!data) return <div className="card loading">Loading…</div>;

  const other = (c: Connection) => data.people.get(c.owner_id === me.id ? c.viewer_id : c.owner_id);
  const named = (list: Connection[]) => list.filter((c) => other(c));
  const incoming = named(data.connections.filter((c) => c.status === "pending" && c.requested_by !== me.id));
  const outgoing = named(data.connections.filter((c) => c.status === "pending" && c.requested_by === me.id));
  const active = data.connections.filter((c) => c.status === "active");
  const myCoach = named(active.filter((c) => c.kind === "coach" && c.owner_id === me.id))[0];
  const coach = myCoach ? other(myCoach)! : null;
  const sharingWith = named(active.filter((c) => c.kind === "friend" && c.owner_id === me.id));
  const canSee = named(active.filter((c) => c.viewer_id === me.id));
  const isCoach = me.account_type === "coach";

  const exists = (owner: string, viewer: string, kind: ConnectionKind) =>
    data.connections.some((c) => c.owner_id === owner && c.viewer_id === viewer && c.kind === kind);

  const changeShares = async (c: Connection, change: Partial<Shares>) => {
    setData({ ...data, connections: data.connections.map((x) => (x.id === c.id ? { ...x, ...change } : x)) });
    try {
      await api.updateSharing(c.id, change);
    } catch (err) {
      console.error(err);
      toast(api.friendlyError(err), "err");
      reload();
    }
  };

  const accept = (c: Connection) => {
    const person = other(c)!;
    if (c.owner_id !== me.id) return run(() => api.respondConnection(c.id, true), `Connected with ${person.display_name}`);
    setStep({
      title: c.kind === "coach" ? `Accept ${person.display_name} as your coach` : `Share your log with ${person.display_name}`,
      confirm: c.kind === "coach" ? "Accept coach" : "Share my log",
      person,
      kind: c.kind,
      withShares: true,
      shares: c,
      run: (choices) => api.respondConnection(c.id, true, choices),
      done: `Connected with ${person.display_name}`,
    });
  };

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    try {
      setFound((await api.findPerson(query)) ?? "none");
    } catch (err) {
      toast(api.friendlyError(err), "err");
    }
  }

  async function makeInvite(kind: ConnectionKind, inviterShares: boolean, notice = false) {
    const code = await api.createInvite(kind, inviterShares, notice);
    setNewInvite({ code, kind, inviter_shares: inviterShares, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
    reload();
  }

  const person = found && found !== "none" ? found : null;

  return (
    <>
      {incoming.length > 0 && (
        <>
          <h2 className="section">Requests</h2>
          <div className="people-list">
            {incoming.map((c) => (
              <section className="card person-card" key={c.id}>
                <PersonLine person={other(c)!} showCoach={c.kind === "coach"}>
                  <div className="person-ask">{describe(c.kind, c.owner_id === me.id, true)}</div>
                </PersonLine>
                <div className="card-actions">
                  <button type="button" className="btn sm" onClick={() => accept(c)}>
                    Accept
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => run(() => api.respondConnection(c.id, false), "Declined")}>
                    Decline
                  </button>
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {myCoach && coach && (
        <>
          <h2 className="section">Your coach</h2>
          <section className="card person-card">
            <PersonLine person={coach} />
            {!myCoach.coach_access_set_at && (
              <p className="replace-warn">
                Choose how much control {coach.display_name} has. Until you do, it&apos;s Add &amp; edit, so nothing can
                be deleted.
              </p>
            )}
            <fieldset className="access-options">
              <legend className="field-label">How much control</legend>
              {ACCESS.map(({ value, title, detail }) => (
                <label key={value} className={`access-option${myCoach.coach_access === value ? " on" : ""}`}>
                  <input
                    type="radio"
                    name="coach-access"
                    checked={myCoach.coach_access === value && !!myCoach.coach_access_set_at}
                    onChange={() => run(() => api.setCoachAccess(myCoach.id, value), `${coach.display_name} now has ${title}`)}
                  />
                  <span>
                    <b>{title}</b>
                    <small>{detail}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="field-label">What they can see</div>
            <ShareToggles value={myCoach} onChange={(change) => changeShares(myCoach, change)} />
            <div className="card-actions">
              <button
                type="button"
                className="btn ghost sm danger"
                onClick={() => {
                  if (confirm(`Remove ${coach.display_name} as your coach? They lose access straight away.`)) {
                    run(() => api.endConnection(myCoach.id), `${coach.display_name} is no longer your coach`);
                  }
                }}
              >
                Remove coach
              </button>
            </div>
          </section>
        </>
      )}

      <h2 className="section">Who can see your log</h2>
      <div className="people-list">
        {sharingWith.length ? (
          sharingWith.map((c) => (
            <section className="card person-card" key={c.id}>
              <PersonLine person={other(c)!} showCoach={false} />
              <ShareToggles value={c} onChange={(change) => changeShares(c, change)} />
              <div className="card-actions">
                <button
                  type="button"
                  className="btn ghost sm danger"
                  onClick={() => {
                    if (confirm(`Stop sharing your log with ${other(c)!.display_name}?`)) {
                      run(() => api.endConnection(c.id), "Stopped sharing");
                    }
                  }}
                >
                  Stop sharing
                </button>
              </div>
            </section>
          ))
        ) : (
          <div className="card no-entries">
            {myCoach ? "Only you and your coach." : "Only you. Share your log below, with a friend or your coach."}
          </div>
        )}
      </div>

      {canSee.length > 0 && (
        <>
          <h2 className="section">Logs you can see</h2>
          <div className="people-list">
            {canSee.map((c) => {
              const owner = other(c)!;
              return (
                <section className="card person-card" key={c.id}>
                  <PersonLine person={owner} showCoach={false}>
                    <div className="person-ask">
                      {c.kind === "coach" ? "Your client" : "Shares with you"}: {sharedList(c)}
                    </div>
                  </PersonLine>
                  <div className="card-actions">
                    <Link href={`/u/${owner.username}`} className="btn sm">
                      Open log
                    </Link>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => {
                        const what = c.kind === "coach" ? `Stop coaching ${owner.display_name}?` : `Stop seeing ${owner.display_name}'s log?`;
                        if (confirm(what)) run(() => api.endConnection(c.id), "Connection ended");
                      }}
                    >
                      {c.kind === "coach" ? "Stop coaching" : "Remove"}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      <h2 className="section">Connect</h2>
      <section className="card connect-card">
        <p className="cx-hint">
          They see only what you tick, and either of you can end it at any time. Nobody ever needs your password.
        </p>
        <form className="search-row" onSubmit={search}>
          <label htmlFor="find-person" className="sr-only">
            Username
          </label>
          <input
            id="find-person"
            value={query}
            autoComplete="off"
            autoCapitalize="none"
            placeholder="Their username"
            onChange={(e) => {
              setQuery(e.target.value);
              setFound(null);
            }}
          />
          <button type="submit" className="btn">
            Find
          </button>
        </form>

        {found === "none" && <p className="status err">There&apos;s no account with that username.</p>}
        {person && person.id === me.id && <p className="status">That&apos;s you.</p>}
        {person && person.id !== me.id && (
          <div className="found">
            <PersonLine person={person} />
            <div className="found-actions">
              {!exists(me.id, person.id, "friend") && !exists(me.id, person.id, "coach") && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() =>
                    setStep({
                      title: `Share your log with ${person.display_name}`,
                      confirm: "Send request",
                      person,
                      kind: "friend",
                      withShares: true,
                      shares: DEFAULT_SHARES.friend,
                      run: (choices) => api.requestConnection(person.id, "friend", true, choices),
                      done: `Asked ${person.display_name}`,
                    })
                  }
                >
                  Share my log with them
                </button>
              )}
              {!exists(person.id, me.id, "friend") && !exists(person.id, me.id, "coach") && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => run(() => api.requestConnection(person.id, "friend", false), `Asked ${person.display_name}`)}
                >
                  Ask to see their log
                </button>
              )}
              {person.account_type === "coach" && !exists(me.id, person.id, "coach") && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() =>
                    setStep({
                      title: `Ask ${person.display_name} to coach you`,
                      confirm: "Send request",
                      person,
                      kind: "coach",
                      withShares: true,
                      shares: DEFAULT_SHARES.coach,
                      run: (choices) => api.requestConnection(person.id, "coach", true, choices),
                      done: `Asked ${person.display_name}`,
                    })
                  }
                >
                  Ask them to be my coach
                </button>
              )}
              {isCoach && !exists(person.id, me.id, "coach") && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => run(() => api.requestConnection(person.id, "coach", false), `Offered to coach ${person.display_name}`)}
                >
                  Offer to coach them
                </button>
              )}
            </div>
          </div>
        )}

        <div className="field-label invite-heading">Or send a link</div>
        <div className="found-actions">
          <button type="button" className="btn ghost sm" onClick={() => run(() => makeInvite("friend", true), "Link made")}>
            Link to share my log
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              setStep({
                title: "Make a link for your coach",
                confirm: "Make link",
                person: null,
                kind: "coach",
                withShares: false,
                shares: DEFAULT_SHARES.coach,
                run: (choices) => makeInvite("coach", true, choices.notice),
                done: "Link made",
              })
            }
          >
            Link for my coach
          </button>
          {isCoach && (
            <button type="button" className="btn ghost sm" onClick={() => run(() => makeInvite("coach", false), "Link made")}>
              Link to invite a client
            </button>
          )}
        </div>
        {newInvite && <InviteBox invite={newInvite} />}
      </section>

      {(outgoing.length > 0 || data.invites.length > 0) && (
        <>
          <h2 className="section">Waiting for an answer</h2>
          <div className="people-list">
            {outgoing.map((c) => (
              <section className="card person-card" key={c.id}>
                <PersonLine person={other(c)!} showCoach={c.kind === "coach"}>
                  <div className="person-ask">{describe(c.kind, c.owner_id === me.id, false)}</div>
                </PersonLine>
                <div className="card-actions">
                  <button type="button" className="btn ghost sm" onClick={() => run(() => api.endConnection(c.id), "Request cancelled")}>
                    Cancel request
                  </button>
                </div>
              </section>
            ))}
            {data.invites
              .filter((i) => i.code !== newInvite?.code)
              .map((invite) => (
                <section className="card person-card" key={invite.code}>
                  <InviteBox
                    invite={invite}
                    onCancel={() => run(() => api.deleteInvite(invite.code), "Link cancelled")}
                  />
                </section>
              ))}
          </div>
        </>
      )}

      {step && (
        <OwnerDialog
          step={step}
          coach={coach}
          onClose={(done) => {
            setStep(null);
            if (done) reload();
          }}
        />
      )}
    </>
  );
}
