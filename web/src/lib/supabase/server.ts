import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabaseEnv } from "./env";

/** Null until Supabase is configured. */
export async function createClient() {
  const env = supabaseEnv();
  if (!env) return null;

  // Supabase's auth code reads the clock, which Next forbids while prerendering.
  // Anything per-user has to render at request time anyway.
  await connection();
  const cookieStore = await cookies();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        // Server Components can't set cookies. The proxy refreshes the session
        // on every request, so it's safe to skip this here.
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {}
      },
    },
  });
}
