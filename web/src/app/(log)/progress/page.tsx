import type { Metadata } from "next";
import { ProgressView } from "@/components/log/progress-view";

export const metadata: Metadata = { title: "Progress · WorkoutTracker" };

export default function ProgressPage() {
  return <ProgressView />;
}
