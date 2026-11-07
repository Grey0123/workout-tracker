import type { Metadata } from "next";
import { NotesView } from "@/components/coach/notes-view";

export const metadata: Metadata = { title: "Client notes · WorkoutTracker" };

export default function ClientNotesPage() {
  return <NotesView />;
}
