import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SRC_COOKIE, SRC_DAYS, sourceFromParams } from "./lib/growth/core";
import { APP_SOURCE } from "./lib/app-mode";
import { buildCsp, CSP_REPORT_PATH, newNonce } from "./lib/csp";

const AUTH_PAGES = ["/login", "/signup"];
// Marketing pages anyone can read.
const OPEN = ["/", "/privacy", "/terms", "/contact", "/help", "/waitlist", "/maintenance", "/unsubscribe", "/app-auth"];
// A review link is its own credential: the reviewer has no account here.
// A share link (/r/code) and a team invite must work before the visitor has an account.
const OPEN_PREFIX = ["/review/", "/r/", "/team/accept"];
// Pages that need a session. Anything not listed here and not public is either a real public file
// (og image, icons) or a typo, and a typo deserves the 404 page, not a sign-in wall.
const STUDIO = ["/home", "/create", "/content", "/calendar", "/analytics", "/inbox", "/approvals", "/accounts", "/billing", "/settings", "/support", "/mascot", "/share-target", "/app-share"];
const needsSession = (p: string) => STUDIO.some((s) => p === s || p.startsWith(s + "/"));
// Old or guessed marketing URLs that point at a section of the home page.
const SECTION_ALIASES: Record<string, string> = { "/pricing": "/#pricing", "/faq": "/#faq", "/features": "/#features" };

const HINT = "outlly_in";
// Readable "waitlist is on" hint, so cached marketing pages can relabel their signup buttons.
const WL_HINT = "outlly_wl";
// Readable list of landing sections the admin hid ("how.pricing"), so the nav and footer can drop those links.
const LH_HINT = "outlly_lh";
// Waitlist on: the whole public site becomes the waitlist page (user's call, 10-12g). These still work:
// the waitlist page itself, the legal pages its form links to, and links that are their own credential
// (emailed invites, team invites, client review links, share links).
const WAITLIST_OPEN = ["/waitlist", "/privacy", "/terms", "/unsubscribe", "/app-auth"];
// Maintenance on: strangers only reach these. /login lets members back in; nobody can sign up.
// /unsubscribe: leaving a mailing list must work whatever mode the site is in.
const MAINTENANCE_OPEN = ["/maintenance", "/login", "/privacy", "/terms", "/unsubscribe", "/app-auth"];
const WAITLIST_PREFIX = ["/review/", "/r/", "/team/accept"];

function sync(req: NextRequest, res: NextResponse, name: string, on: boolean, maxAge: number) {
  const has = req.cookies.get(name)?.value === "1";
  if (on && !has) res.cookies.set(name, "1", { path: "/", sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge });
  if (!on && has) res.cookies.delete(name);
}

/** Keep the readable hints (not credentials) in step with the real session and the waitlist switch, so public pages can stay cached. */
function hint(req: NextRequest, res: NextResponse, authed: boolean) {
  sync(req, res, HINT, authed, 60 * 60 * 24 * 30);
  sync(req, res, WL_HINT, !!status?.waitlist, 60 * 60 * 24);
  const want = status?.hide ?? "";
  const has = req.cookies.get(LH_HINT)?.value ?? "";
  if (want && want !== has) res.cookies.set(LH_HINT, want, { path: "/", sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 });
  if (!want && has) res.cookies.delete(LH_HINT);
  return res;
}

// Maintenance and waitlist flags, read through the public status API (edge middleware can't open the
// database). Cached per instance for a few seconds so a busy site doesn't call it on every page view.
let status: { at: number; maintenance: boolean; waitlist: boolean; hide: string } | null = null;
let warned = false;
async function siteFlags(req: NextRequest) {
  if (status && Date.now() - status.at < 5_000) return status;
  let maintenance = status?.maintenance ?? false;
  let waitlist = status?.waitlist ?? false;
  let hide = status?.hide ?? "";
  try {
    // Never build this URL from the request: the Host header is the visitor's to choose, and the answer
    // is cached for everyone on this instance. APP_URL is ours; fall back to the request only in dev.
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const base =
      process.env.APP_URL ||
      (vercel ? `https://${vercel}` : "") ||
      (process.env.NODE_ENV === "production" ? "" : req.nextUrl.origin);
    if (!base) {
      if (!warned) console.error("[middleware] APP_URL is not set: maintenance and waitlist flags cannot be read");
      warned = true;
      throw new Error("APP_URL not set");
    }
    const r = await fetch(new URL("/api/maintenance", base), { cache: "no-store", signal: AbortSignal.timeout(1_500) });
    if (r.ok) {
      const j = await r.json();
      maintenance = !!j.maintenance;
      waitlist = !!j.waitlist;
      // Only plain anchor names get into the cookie.
      hide = Array.isArray(j.hide) ? j.hide.filter((x: unknown) => typeof x === "string" && /^[a-z]{1,20}$/.test(x)).slice(0, 20).join(".") : "";
    }
  } catch {
    /* status API unreachable: keep the last known state rather than flapping */
  }
  status = { at: Date.now(), maintenance, waitlist, hide };
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

/** The Android app launches with ?source=twa; carry it through sign-in redirects so the first page that renders knows it's the app. */
export function keepAppSource(req: NextRequest, to: URL) {
  if (req.nextUrl.searchParams.get("source") === APP_SOURCE) to.searchParams.set("source", APP_SOURCE);
  return to;
}

export async function middleware(req: NextRequest) {
  // Per-request nonce (1033). Next reads it from the request's CSP header and stamps it on its own inline
  // scripts; the root layout reads x-nonce for ours. Every page answer, rewrites included, carries the policy.
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-path", req.nextUrl.pathname + req.nextUrl.search); // where a stale session should return to after signing in (1042)
  headers.set("content-security-policy", csp);
  const res = await route(req, headers);
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Reporting-Endpoints", `csp="${req.nextUrl.origin}${CSP_REPORT_PATH}"`); // must be absolute
  // The old admin-only notice bar is gone; clear its cookie from browsers that still have it.
  if (req.cookies.get("outlly_af")) res.cookies.delete("outlly_af");
  // Campaign links (Growth page): remember the FIRST utm link a visitor arrived on, for 30 days,
  // so signup can credit the channel. Never overwritten by a later link.
  const src = req.cookies.get(SRC_COOKIE) ? null : sourceFromParams(req.nextUrl.searchParams);
  if (src) res.cookies.set(SRC_COOKIE, src, { path: "/", httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * SRC_DAYS });
  return res;
}

/*
 * A Google sign-in started in the Android app runs in a Custom Tab. When it ends on an error page
 * (/login?google_error, or the waitlist) instead of the usual way back, send it to the app anyway, so the
 * creator isn't left in the browser. Mirrors APP_CH_COOKIE / APP_RETURN_PATH in lib/app-handoff.ts.
 */
export function appBounce(req: NextRequest) {
  if (!req.cookies.get("ol_app_ch")?.value) return null;
  const { pathname, searchParams } = req.nextUrl;
  const stuck = (pathname === "/login" && searchParams.has("google_error")) || (pathname === "/waitlist" && searchParams.get("from") === "google");
  if (!stuck) return null;
  const u = new URL("/api/app/return", req.url);
  u.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(u);
}

async function route(req: NextRequest, headers: Headers) {
  const { pathname } = req.nextUrl;
  const pass = () => NextResponse.next({ request: { headers } });
  const bounce = appBounce(req);
  if (bounce) return bounce;
  const alias = SECTION_ALIASES[pathname];
  if (alias) return NextResponse.redirect(new URL(alias, req.url), 308);
  const adminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const flags = adminArea ? null : await siteFlags(req);
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
  // Maintenance on (10-13): members keep using the whole site and keep posting. Everyone else sees the
  // maintenance page, except sign-in (so a member can get back in) and the legal pages it links to.
  // No account can be created while it is on, and the APIs re-check the member's join date.
  if (flags?.maintenance && !authed && !MAINTENANCE_OPEN.includes(pathname) && !(await isAdmin(req))) {
    const res = NextResponse.rewrite(new URL("/maintenance", req.url), { request: { headers } });
    res.headers.set("cache-control", "no-store");
    return res;
  }
  if (flags?.maintenance && authed && pathname === "/maintenance" && !req.nextUrl.searchParams.has("preview")) return hint(req, NextResponse.redirect(new URL("/home", req.url)), authed);
  // Waitlist on: every public page sends signed-out visitors to the waitlist. People who already
  // have an account keep working: /login stays open, and a signed-in creator is never bounced out
  // of the studio (the signup API still refuses strangers on its own).
  if (flags?.waitlist && !authed && pathname !== "/login" && !WAITLIST_OPEN.includes(pathname) && !WAITLIST_PREFIX.some((p) => pathname.startsWith(p))) {
    const invited = pathname === "/signup" && (req.nextUrl.searchParams.has("invite") || (req.nextUrl.searchParams.get("next") ?? "").startsWith("/team/accept"));
    if (!invited) return hint(req, NextResponse.redirect(new URL("/waitlist", req.url)), authed);
  }
  // Admin has its own session. Middleware only checks the cookie is there; every admin page
  // and API re-verifies the signature, the role and the password fingerprint on the server.
  if (pathname === "/admin/login") return pass();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (req.cookies.get("outly_admin")?.value) return pass();
    const u = new URL("/admin/login", req.url);
    if (pathname !== "/admin") u.searchParams.set("next", pathname);
    return NextResponse.redirect(u);
  }
  if (OPEN.includes(pathname) || OPEN_PREFIX.some((p) => pathname.startsWith(p))) return hint(req, pass(), authed);
  // Waitlist on: the signup page becomes the waitlist. Emailed invitees (?invite), teammates
  // accepting an invite and admins still reach it; the signup API re-checks every one of them.
  if (!authed && pathname === "/signup" && flags?.waitlist) {
    const sp = req.nextUrl.searchParams;
    const through = sp.has("invite") || (sp.get("next") ?? "").startsWith("/team/accept") || (await isAdmin(req));
    if (!through) return hint(req, NextResponse.redirect(new URL("/waitlist", req.url)), authed);
  }
  if (!authed && !AUTH_PAGES.includes(pathname) && needsSession(pathname)) {
    const u = new URL("/login", req.url);
    u.searchParams.set("next", pathname + req.nextUrl.search);
    return hint(req, NextResponse.redirect(keepAppSource(req, u)), authed);
  }
  if (authed && AUTH_PAGES.includes(pathname)) return hint(req, NextResponse.redirect(keepAppSource(req, new URL("/home", req.url))), authed);
  return hint(req, pass(), authed);
}

export const config = {
  // Pages only. API routes do their own auth and return JSON 401s.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|\\.well-known|.*\\.(?:svg|png|jpg|gif|webp|ico|txt|xml|js|html|webmanifest)$).*)"],
};
