import type { Metadata } from "next";
import { CalendarView } from "@/components/log/calendar-view";

export const metadata: Metadata = { title: "Calendar · WorkoutTracker" };

export default function CalendarPage() {
  return <CalendarView />;
}
