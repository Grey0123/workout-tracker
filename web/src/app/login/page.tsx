import type { Metadata } from "next";
import { LogInForm } from "@/components/auth-form";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Log in · WorkoutTracker" };

export default function LogInPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-col gap-3.5 px-3.5 py-4">
        <h1 className="font-display text-[26px] leading-tight font-semibold">Log in</h1>
        <LogInForm />
      </main>
    </>
  );
}
