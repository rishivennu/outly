import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const AUTH_PAGES = ["/login", "/signup"];
// Marketing pages anyone can read.
const OPEN = ["/", "/privacy", "/terms", "/contact", "/help", "/waitlist"];
// A review link is its own credential: the reviewer has no account here.
// A share link (/r/code) and a team invite must work before the visitor has an account.
const OPEN_PREFIX = ["/review/", "/r/", "/team/accept"];

const HINT = "outlly_in";
// Readable "waitlist is on" hint, so cached marketing pages can relabel their signup buttons.
const WL_HINT = "outlly_wl";

function sync(req: NextRequest, res: NextResponse, name: string, on: boolean, maxAge: number) {
  const has = req.cookies.get(name)?.value === "1";
  if (on && !has) res.cookies.set(name, "1", { path: "/", sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge });
  if (!on && has) res.cookies.delete(name);
}

/** Keep the readable hints (not credentials) in step with the real session and the waitlist switch, so public pages can stay cached. */
function hint(req: NextRequest, res: NextResponse, authed: boolean) {
  sync(req, res, HINT, authed, 60 * 60 * 24 * 30);
  sync(req, res, WL_HINT, !!status?.waitlist, 60 * 60 * 24);
  return res;
}

// Maintenance and waitlist flags, read through the public status API (edge middleware can't open the
// database). Cached per instance for a few seconds so a busy site doesn't call it on every page view.
let status: { at: number; maintenance: boolean; waitlist: boolean } | null = null;
async function siteFlags(req: NextRequest) {
  if (status && Date.now() - status.at < 5_000) return status;
  let maintenance = status?.maintenance ?? false;
  let waitlist = status?.waitlist ?? false;
  try {
    const r = await fetch(new URL("/api/maintenance", req.url), { cache: "no-store", signal: AbortSignal.timeout(1_500) });
    if (r.ok) {
      const j = await r.json();
      maintenance = !!j.maintenance;
      waitlist = !!j.waitlist;
    }
  } catch {
    /* status API unreachable: keep the last known state rather than flapping */
  }
  status = { at: Date.now(), maintenance, waitlist };
  return status;
}

/** A real, signed admin session (not just a cookie being present) bypasses maintenance. */
async function isAdmin(req: NextRequest) {
  const t = req.cookies.get("outly_admin")?.value;
  if (!t) return false;
  try {
    await jwtVerify(t, new TextEncoder().encode((process.env.AUTH_SECRET ?? "") + ":admin"), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const adminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const flags = adminArea ? null : await siteFlags(req);
  if (flags && pathname !== "/maintenance" && flags.maintenance && !(await isAdmin(req))) {
    return NextResponse.rewrite(new URL("/maintenance", req.url));
  }
  // Admin has its own session. Middleware only checks the cookie is there; every admin page
  // and API re-verifies the signature, the role and the password fingerprint on the server.
  if (pathname === "/admin/login") return NextResponse.next();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (req.cookies.get("outly_admin")?.value) return NextResponse.next();
    const u = new URL("/admin/login", req.url);
    if (pathname !== "/admin") u.searchParams.set("next", pathname);
    return NextResponse.redirect(u);
  }
  const token = req.cookies.get("studio_session")?.value;
  let authed = false;
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET ?? ""), { algorithms: ["HS256"] });
      authed = true;
    } catch {
      authed = false;
    }
  }
  if (OPEN.includes(pathname) || OPEN_PREFIX.some((p) => pathname.startsWith(p))) return hint(req, NextResponse.next(), authed);
  // Waitlist on: the signup page becomes the waitlist. Emailed invitees (?invite), teammates
  // accepting an invite and admins still reach it; the signup API re-checks every one of them.
  if (!authed && pathname === "/signup" && flags?.waitlist) {
    const sp = req.nextUrl.searchParams;
    const through = sp.has("invite") || (sp.get("next") ?? "").startsWith("/team/accept") || (await isAdmin(req));
    if (!through) return hint(req, NextResponse.redirect(new URL("/waitlist", req.url)), authed);
  }
  if (!authed && !AUTH_PAGES.includes(pathname)) {
    const u = new URL("/login", req.url);
    u.searchParams.set("next", pathname + req.nextUrl.search);
    return hint(req, NextResponse.redirect(u), authed);
  }
  if (authed && AUTH_PAGES.includes(pathname)) return hint(req, NextResponse.redirect(new URL("/home", req.url)), authed);
  return hint(req, NextResponse.next(), authed);
}

export const config = {
  // Pages only. API routes do their own auth and return JSON 401s.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|ico|txt|xml|js|html|webmanifest)$).*)"],
};
