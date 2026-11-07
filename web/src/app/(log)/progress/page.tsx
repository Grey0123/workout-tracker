import type { Metadata } from "next";
import { ProgressView } from "@/components/progress/progress-view";

export const metadata: Metadata = { title: "Progress · WorkoutTracker" };

export default function ProgressPage() {
  return <ProgressView />;
}
