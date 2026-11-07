"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLog } from "@/components/log/log-provider";
import * as api from "@/lib/people/api";
import { DEFAULT_SHARES, type InviteDetails, type Person } from "@/lib/people/types";
import { CoachNotice, PersonLine, ShareToggles } from "./bits";

type Loaded = { invite: InviteDetails | null; coach: Person | null };

/** What opening this invite would do, from the opener's side. */
function meaning(invite: InviteDetails) {
  if (invite.kind === "coach") {
    return invite.inviter_shares
      ? { text: "invites you to be their coach.", iOwn: false, needsCoachAccount: true }
      : { text: "invites you to be their client. They'd become your coach.", iOwn: true, needsCoachAccount: false };
  }
  return invite.inviter_shares
    ? { text: "wants to share their log with you.", iOwn: false, needsCoachAccount: false }
    : { text: "asks to see your log.", iOwn: true, needsCoachAccount: false };
}

export function InviteView() {
  const { code } = useParams<{ code: string }>();
  const { profile: me, toast } = useLog();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState(false);
  const [shares, setShares] = useState(DEFAULT_SHARES.coach);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.inviteDetails(code), api.currentCoach(me.id)]).then(
      ([invite, coach]) => {
        if (!live) return;
        setLoaded({ invite, coach });
        if (invite) setShares(DEFAULT_SHARES[invite.kind]);
      },
      (err) => {
        console.error(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [code, me.id]);

  if (failed) return <div className="card loading">Couldn&apos;t open this invite. Check your connection and try again.</div>;
  if (!loaded) return <div className="card loading">Loading…</div>;

  const { invite, coach } = loaded;
  const stop = (text: string) => (
    <section className="card invite-card">
      <p>{text}</p>
      <Link href="/people" className="btn ghost">
        Go to People
      </Link>
    </section>
  );
  if (!invite) return stop("This invite link doesn't exist. Check you copied all of it.");
  if (invite.mine) return stop("This is your own invite link. Send it to the other person.");
  if (!invite.usable) return stop("This invite link has expired or was already used. Ask for a new one.");

  const inviter: Person = { id: "", username: invite.username, display_name: invite.display_name, account_type: invite.account_type };
  const { text, iOwn, needsCoachAccount } = meaning(invite);
  if (needsCoachAccount && me.account_type !== "coach") {
    return stop(`${invite.display_name} made this link for a coach account, and yours is a user account.`);
  }
  const isCoachLink = invite.kind === "coach";
  const replacing = isCoachLink && iOwn && coach ? coach : null;

  async function accept() {
    setBusy(true);
    try {
      await api.acceptInvite(code, { notice, replace: !!replacing, shares: iOwn ? shares : undefined });
      toast(`Connected with ${invite!.display_name}`);
      router.push(iOwn ? "/people" : `/u/${invite!.username}`);
    } catch (err) {
      console.error(err);
      toast(api.friendlyError(err), "err");
      setBusy(false);
    }
  }

  return (
    <section className="card invite-card">
      <PersonLine person={inviter} showCoach={isCoachLink && !iOwn ? false : invite.account_type === "coach"}>
        <div className="person-ask">{text}</div>
      </PersonLine>

      {iOwn ? (
        <>
          {isCoachLink && <CoachNotice coachName={invite.display_name} accepted={notice} onAccept={setNotice} />}
          {replacing && (
            <p className="replace-warn">
              You can have one coach at a time. This replaces <b>{replacing.display_name}</b>, who loses access straight away.
            </p>
          )}
          <div className="field-label">What they can see</div>
          <ShareToggles value={shares} onChange={(change) => setShares({ ...shares, ...change })} />
        </>
      ) : (
        <p className="cx-hint">
          You&apos;ll see what {invite.display_name} shares with you. They choose, and can stop at any time.
        </p>
      )}

      <div className="card-actions">
        <button type="button" className="btn" disabled={busy || (isCoachLink && iOwn && !notice)} onClick={accept}>
          {busy ? "Connecting…" : "Accept"}
        </button>
        <Link href="/" className="btn ghost">
          Not now
        </Link>
      </div>
    </section>
  );
}
