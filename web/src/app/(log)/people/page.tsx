import type { Metadata } from "next";
import { PeopleView } from "@/components/people/people-view";

export const metadata: Metadata = { title: "People · WorkoutTracker" };

export default function PeoplePage() {
  return <PeopleView />;
}
