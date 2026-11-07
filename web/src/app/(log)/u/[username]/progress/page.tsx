import type { Metadata } from "next";
import { ProgressView } from "@/components/progress/progress-view";

export const metadata: Metadata = { title: "Shared progress · WorkoutTracker" };

export default function SharedProgressPage() {
  return <ProgressView />;
}
