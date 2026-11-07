import type { Metadata } from "next";
import { NotificationsView } from "@/components/coach/notifications-view";

export const metadata: Metadata = { title: "Notifications · WorkoutTracker" };

export default function NotificationsPage() {
  return <NotificationsView />;
}
