"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SetupNotice } from "@/components/setup-notice";
import { createClient } from "@/lib/supabase/client";
import { supabaseEnv } from "@/lib/supabase/env";

const inputClass =
  "min-h-[46px] rounded-control border-[1.5px] border-line bg-surface px-3 text-[15px] text-ink";
const cardClass = "flex flex-col gap-3.5 rounded-card border border-line bg-surface p-4 shadow-card";
const primaryClass =
  "min-h-[50px] rounded-control bg-blue font-display text-base font-semibold tracking-[0.08em] text-white uppercase disabled:opacity-60";
const labelClass = "flex flex-col gap-1.5";
const labelTextClass = "text-[13px] font-semibold";

type AccountType = "user" | "coach";

/** A full page load, so nothing from the previous session stays in the router's cache. */
const goTo = (path: string) => window.location.assign(path);

const ACCOUNT_TYPES: { value: AccountType; title: string; detail: string }[] = [
  { value: "user", title: "User", detail: "Log your training and meals, and share them." },
  { value: "coach", title: "Coach", detail: "All of that, plus a workspace for your clients." },
];

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={labelClass}>
      <span className={labelTextClass}>{label}</span>
      <input className={inputClass} required {...input} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-control bg-red-soft px-3 py-2.5 text-sm font-medium text-red">
      {message}
    </p>
  );
}

export function SignUpForm() {
  const [accountType, setAccountType] = useState<AccountType>("user");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (!supabaseEnv()) return <SetupNotice />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const username = String(form.get("username")).trim().toLowerCase();

    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      setError("Usernames are 3 to 30 characters: letters, numbers and underscores.");
      return;
    }
    if (accountType === "coach" && !accepted) {
      setError("Tick the notice to create a coach account.");
      return;
    }

    setBusy(true);
    setError("");
    const { data, error: failed } = await createClient().auth.signUp({
      email,
      password: String(form.get("password")),
      options: {
        data: {
          username,
          display_name: String(form.get("display_name")).trim(),
          account_type: accountType,
          coach_disclaimer_accepted: accountType === "coach" && accepted,
        },
      },
    });
    setBusy(false);

    if (failed) {
      // The profile is created by a database trigger. Supabase reports any
      // failure there generically, and a taken username is the likely one.
      setError(
        failed.message.includes("Database error")
          ? "That username may already be taken. Try another one."
          : failed.message,
      );
      return;
    }
    if (data.session) {
      goTo("/");
    } else {
      setCheckEmail(email);
    }
  }

  if (checkEmail) {
    return (
      <div className={cardClass}>
        <h2 className="font-display text-[21px] font-semibold">Check your email</h2>
        <p className="text-sm text-muted">We sent a confirmation link to {checkEmail}. Open it to finish signing up.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <fieldset className={cardClass}>
        <legend className="sr-only">Account type</legend>
        <span className={labelTextClass}>I&apos;m signing up as</span>
        <div className="grid grid-cols-2 gap-2">
          {ACCOUNT_TYPES.map(({ value, title, detail }) => (
            <label
              key={value}
              className={`flex cursor-pointer flex-col gap-1 rounded-control border-[1.5px] p-3 has-focus-visible:outline-2 has-focus-visible:outline-blue ${
                accountType === value ? "border-blue bg-blue-soft" : "border-line bg-surface"
              }`}
            >
              <input
                type="radio"
                name="account_type"
                value={value}
                checked={accountType === value}
                onChange={() => setAccountType(value)}
                className="sr-only"
              />
              <span className="font-semibold">{title}</span>
              <span className="text-xs text-muted">{detail}</span>
            </label>
          ))}
        </div>
        {accountType === "coach" && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-control bg-amber-soft p-3 text-[13px] text-amber-ink">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-0.5 size-[18px] shrink-0"
            />
            <span>
              I understand my account is a <b>self-declared coach</b>, not verified or certified by WorkoutTracker, and
              that I&apos;m responsible for the advice I give.
            </span>
          </label>
        )}
      </fieldset>

      <div className={cardClass}>
        <Field label="Your name" name="display_name" autoComplete="name" maxLength={60} />
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          maxLength={30}
          hint="People use this to find you. Letters, numbers and underscores."
        />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters." />
      </div>

      {error && <FormError message={error} />}

      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-blue">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function LogInForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!supabaseEnv()) return <SetupNotice />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    const { error: failed } = await createClient().auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (failed) {
      setError(failed.message);
      return;
    }
    goTo("/");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <div className={cardClass}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
      </div>
      {error && <FormError message={error} />}
      <button type="submit" disabled={busy} className={primaryClass}>
        {busy ? "Logging in…" : "Log in"}
      </button>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-blue">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        goTo("/login");
      }}
      className="min-h-[48px] rounded-control border-[1.5px] border-line bg-surface font-display text-[15px] font-semibold tracking-[0.08em] text-ink uppercase"
    >
      Log out
    </button>
  );
}
