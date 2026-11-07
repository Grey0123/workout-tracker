import type { Metadata } from "next";
import { ClientsView } from "@/components/coach/clients-view";

export const metadata: Metadata = { title: "Clients · WorkoutTracker" };

export default function ClientsPage() {
  return <ClientsView />;
}
