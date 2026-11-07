import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/next-path";
import { supabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/signup"];

/** Keeps the session fresh and sends signed-out visitors to the log-in page. */
export async function proxy(request: NextRequest) {
  const env = supabaseEnv();
  if (!env) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);
  if (!user && !isPublic) {
    // Come back here after logging in, so an invite link still works when opened signed out.
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (user && isPublic) return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
