import type { Metadata } from "next";
import { CalendarView } from "@/components/log/calendar-view";

export const metadata: Metadata = { title: "Shared calendar · WorkoutTracker" };

export default function SharedCalendarPage() {
  return <CalendarView />;
}
