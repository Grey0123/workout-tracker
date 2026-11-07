import type { Metadata } from "next";
import { HomeView } from "@/components/log/home-view";

export const metadata: Metadata = { title: "Shared log · WorkoutTracker" };

export default function SharedHomePage() {
  return <HomeView />;
}
