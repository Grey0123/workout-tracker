/**
 * The real migrations on PGlite, an in-process Postgres, with stand-ins for the
 * parts of Supabase they rely on. These need no Docker and no Supabase project.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "supabase", "migrations");

export const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;

  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
                                file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1 : cardinality(string_to_array(name, '/')) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

export type Row = Record<string, unknown>;

/** A fresh database with every migration applied, and helpers to act as someone. */
export async function openDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  let seq = 0;

  async function asRole<T>(role: string, id: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  const as = <T>(user: string, fn: () => Promise<T>) => asRole("authenticated", user, fn);
  const rows = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;
  const changed = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).affectedRows ?? 0;

  async function newUser(type: "user" | "coach" = "user"): Promise<string> {
    const n = ++seq;
    const meta = { username: `u${n}_${type}`, display_name: `User ${n}`, account_type: type, coach_disclaimer_accepted: type === "coach" };
    const [row] = await rows("insert into auth.users (raw_user_meta_data) values ($1) returning id", [JSON.stringify(meta)]);
    return row.id as string;
  }

  /** An active connection written directly, as if both people had agreed. */
  async function connect(owner: string, viewer: string, kind: "friend" | "coach", extra: Record<string, unknown> = {}) {
    const cols = ["owner_id", "viewer_id", "kind", "status", ...Object.keys(extra)];
    const vals = [owner, viewer, kind, "active", ...Object.values(extra)];
    const [row] = await rows(
      `insert into public.connections (${cols.join(", ")}) values (${vals.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      vals,
    );
    return row.id as string;
  }

  return { db, asRole, as, rows, changed, newUser, connect };
}
