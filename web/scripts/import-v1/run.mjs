#!/usr/bin/env node
/**
 * Imports v1's history into one v2 account. Previews by default.
 *
 *   npm run import:v1 -- --username your_username            preview, writes nothing
 *   npm run import:v1 -- --username your_username --write    writes it
 *
 * --source reads a saved JSON file or another URL instead of v1's live endpoint.
 * Only writes to local Supabase unless --allow-remote is passed.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { transform } from "./transform.mjs";
import { verifyPlan, writePlan } from "./write.mjs";

const { values: args } = parseArgs({
  options: {
    username: { type: "string" },
    source: { type: "string" },
    write: { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
});

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

async function loadV1(source) {
  const from = source ?? readFileSync("../app.js", "utf8").match(/APPS_SCRIPT_URL\s*=\s*"([^"]+)"/)?.[1];
  if (!from) fail("Couldn't find v1's URL in ../app.js. Pass --source.");
  if (!/^https?:/.test(from)) return JSON.parse(readFileSync(from, "utf8"));
  const res = await fetch(`${from}${from.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) fail(`v1 returned ${res.status}.`);
  return res.json();
}

function section(title, lines) {
  if (!lines.length) return;
  console.log(`\n${title} (${lines.length})`);
  for (const line of lines) console.log(`  - ${line}`);
}

if (!args.username) fail("Pass --username, the v2 account that receives the data.");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
if (args.write && !isLocal && !args["allow-remote"]) fail(`${url} isn't local. Pass --allow-remote if you mean it.`);

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: profile, error: profileError } = await db
  .from("profiles")
  .select("id, display_name")
  .eq("username", args.username.toLowerCase())
  .maybeSingle();
if (profileError) fail(`Couldn't reach Supabase: ${profileError.message}`);
if (!profile) fail(`No account with the username "${args.username}". Sign up on the site first.`);

const { data: existing, error: exerciseError } = await db
  .from("exercises")
  .select("id, name, is_custom")
  .or(`is_custom.eq.false,created_by.eq.${profile.id}`);
if (exerciseError) fail(exerciseError.message);

const plan = transform(await loadV1(args.source), profile.id, existing);
const { report } = plan;

console.log(`\nImport for ${profile.display_name} (@${args.username}) into ${url}`);
console.log(`  ${plan.sessions.length} training days, ${plan.sessionExercises.length} exercise entries, ${plan.sets.length} sets`);
console.log(`  ${plan.meals.length} meals, ${plan.meals.filter((m) => m.photoUrl).length} with photos`);
console.log(`  ${plan.exercises.length} exercises to add to this account, ${plan.reusedExercises} already known`);
section("Times read from notes, please check", report.corrected);
section("Names corrected", report.renamed);
section("Exercises with no known muscle group, filed under Full body & conditioning", report.uncategorised);
section("Duplicate meals", report.duplicateMeals);
section("Skipped", report.skipped);

if (!args.write) {
  console.log("\nPreview only, nothing was written. Add --write to import.");
  process.exit(0);
}

const { photoFailures } = await writePlan(db, profile.id, plan);
section("Photos that couldn't be copied, their meals were kept", photoFailures);

const problems = await verifyPlan(db, profile.id, plan);
if (problems.length) {
  section("Written, but the read-back doesn't match", problems);
  fail("Running the import again is safe.");
}
console.log("\nImported, and the read-back matches.");
