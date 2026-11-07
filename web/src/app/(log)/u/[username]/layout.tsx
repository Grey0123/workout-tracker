import { Suspense } from "react";
import { SharedLog } from "@/components/people/shared-log";

export default function SharedLogLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="card loading">Loading…</div>}>
      <SharedLog>{children}</SharedLog>
    </Suspense>
  );
}
