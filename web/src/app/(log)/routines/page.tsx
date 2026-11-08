import type { Metadata } from "next";
import { RoutinesView } from "@/components/routines/routines-view";

export const metadata: Metadata = { title: "Routines · WorkoutTracker" };

export default function RoutinesPage() {
  return <RoutinesView />;
}
