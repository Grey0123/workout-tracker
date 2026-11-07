import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth-form";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Sign up · WorkoutTracker" };

export default function SignUpPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-col gap-3.5 px-3.5 py-4">
        <h1 className="font-display text-[26px] leading-tight font-semibold">Create your account</h1>
        <SignUpForm />
      </main>
    </>
  );
}
