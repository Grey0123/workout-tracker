import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteView } from "@/components/people/invite-view";

export const metadata: Metadata = { title: "Invite · WorkoutTracker" };

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="card loading">Loading…</div>}>
      <InviteView />
    </Suspense>
  );
}
