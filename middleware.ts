import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SRC_COOKIE, SRC_DAYS, sourceFromParams } from "./lib/growth/core";

const AUTH_PAGES = ["/login", "/signup"];
// Marketing pages anyone can read.
const OPEN = ["/", "/privacy", "/terms", "/contact", "/help", "/waitlist", "/maintenance", "/unsubscribe"];
// A review link is its own credential: the reviewer has no account here.
// A share link (/r/code) and a team invite must work before the visitor has an account.
const OPEN_PREFIX = ["/review/", "/r/", "/team/accept"];
// Pages that need a session. Anything not listed here and not public is either a real public file
// (og image, icons) or a typo, and a typo deserves the 404 page, not a sign-in wall.
const STUDIO = ["/home", "/create", "/content", "/calendar", "/analytics", "/inbox", "/approvals", "/accounts", "/billing", "/settings", "/support", "/mascot", "/share-target"];
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
const WAITLIST_OPEN = ["/waitlist", "/privacy", "/terms", "/unsubscribe"];
// Maintenance on: strangers only reach these. /login lets members back in; nobody can sign up.
// /unsubscribe: leaving a mailing list must work whatever mode the site is in.
const MAINTENANCE_OPEN = ["/maintenance", "/login", "/privacy", "/terms", "/unsubscribe"];
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

export async function middleware(req: NextRequest) {
  const res = await route(req);
  // The old admin-only notice bar is gone; clear its cookie from browsers that still have it.
  if (req.cookies.get("outlly_af")) res.cookies.delete("outlly_af");
  // Campaign links (Growth page): remember the FIRST utm link a visitor arrived on, for 30 days,
  // so signup can credit the channel. Never overwritten by a later link.
  const src = req.cookies.get(SRC_COOKIE) ? null : sourceFromParams(req.nextUrl.searchParams);
  if (src) res.cookies.set(SRC_COOKIE, src, { path: "/", httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24 * SRC_DAYS });
  return res;
}

async function route(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
    const res = NextResponse.rewrite(new URL("/maintenance", req.url));
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
  if (pathname === "/admin/login") return NextResponse.next();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (req.cookies.get("outly_admin")?.value) return NextResponse.next();
    const u = new URL("/admin/login", req.url);
    if (pathname !== "/admin") u.searchParams.set("next", pathname);
    return NextResponse.redirect(u);
  }
  if (OPEN.includes(pathname) || OPEN_PREFIX.some((p) => pathname.startsWith(p))) return hint(req, NextResponse.next(), authed);
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
    return hint(req, NextResponse.redirect(u), authed);
  }
  if (authed && AUTH_PAGES.includes(pathname)) return hint(req, NextResponse.redirect(new URL("/home", req.url)), authed);
  return hint(req, NextResponse.next(), authed);
}

export const config = {
  // Pages only. API routes do their own auth and return JSON 401s.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|ico|txt|xml|js|html|webmanifest)$).*)"],
};
