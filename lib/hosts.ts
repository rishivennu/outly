// 1185: every outlly.com subdomain is an entry point into the one deployment (one database, one sign-in).
// Pure and client-safe: middleware.ts, tests and docs/SUBDOMAINS.md all read this table.
// The request's Host header is only ever looked up in this table. Every redirect target is built from the canonical
// base (or a fixed host below), never from the Host header, so a forged Host can't turn us into an open redirect.
// Session cookies stay host-only on purpose: email.outlly.com (webmail) and the Resend tracking hosts are not ours to
// trust, so a session on www is never sent to another subdomain. admin.outlly.com is therefore its own origin.

export const CANONICAL_ORIGIN = "https://www.outlly.com";

/** The studio pages that need a session (middleware's sign-in wall uses this same list). */
export const STUDIO_PATHS = ["/home", "/create", "/content", "/calendar", "/analytics", "/intelligence", "/profile-review", "/inbox", "/approvals", "/accounts", "/billing", "/settings", "/support", "/mascot", "/share-target", "/app-share", "/dashboard"];

export const ADMIN_SUBDOMAIN = "admin.outlly.com";

const OUTLLY = /^(?:[a-z0-9-]+\.)*outlly\.com$/;

/** APP_URL when it is an https outlly.com URL (its origin), else the production www origin. */
export function canonicalBase(appUrl?: string): string {
  if (!appUrl) return CANONICAL_ORIGIN;
  try {
    const u = new URL(appUrl);
    return u.protocol === "https:" && OUTLLY.test(u.hostname) ? u.origin : CANONICAL_ORIGIN;
  } catch {
    return CANONICAL_ORIGIN;
  }
}

/** Lower-cased hostname without port or trailing dot. */
export function hostOf(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().split(":", 1)[0].replace(/\.$/, "");
}

type Module = { landing: string; keep: string[]; prefix?: string };

const AUTH = ["/login", "/signup"];
const STUDIO_HOME: Module = { landing: "/home", keep: [...STUDIO_PATHS, ...AUTH] };

/** "redirect" hosts: 307 to the canonical origin. `keep`: paths kept as they are. `prefix`: any other path is moved under it. */
export const REDIRECT_HOSTS: Record<string, Module> = {
  "app.outlly.com": STUDIO_HOME,
  "dashboard.outlly.com": STUDIO_HOME,
  "studio.outlly.com": { landing: "/create", keep: ["/create"] },
  // The content library is where queued, scheduled and published posts live (there is no separate queue page).
  "publish.outlly.com": { landing: "/content", keep: ["/content", "/approvals"] },
  "scheduler.outlly.com": { landing: "/calendar", keep: ["/calendar"] },
  "analytics.outlly.com": { landing: "/analytics", keep: ["/analytics"] },
  "integrations.outlly.com": { landing: "/accounts", keep: ["/accounts"] },
  "auth.outlly.com": { landing: "/login", keep: AUTH },
  "help.outlly.com": { landing: "/help", keep: ["/help"] },
  "docs.outlly.com": { landing: "/help", keep: ["/help"] },
  "status.outlly.com": { landing: "/status", keep: ["/status"] },
  "blog.outlly.com": { landing: "/blog", keep: ["/blog"], prefix: "/blog" },
  "pricing.outlly.com": { landing: "/#pricing", keep: [] },
};

export const API_HOST = "api.outlly.com";
export const WEBHOOK_HOST = "webhooks.outlly.com";
export const STATIC_HOSTS = ["media.outlly.com", "cdn.outlly.com"];
/** Hosts the middleware matcher must also run on for /api and static files (config.matcher in middleware.ts mirrors this). */
export const ALL_PATH_HOSTS = [API_HOST, WEBHOOK_HOST, ...STATIC_HOSTS];

/** Short webhook URLs, each to the one real route (POST bodies and signatures pass through a rewrite untouched). */
export const WEBHOOK_ROUTES: Record<string, string> = {
  "/meta": "/api/webhooks/meta",
  "/meta/deletion": "/api/webhooks/meta/deletion",
  "/resend": "/api/webhooks/resend",
  "/razorpay": "/api/billing/webhooks/razorpay",
  "/stripe": "/api/billing/webhooks/stripe",
  "/paypal": "/api/billing/webhooks/paypal",
  "/youpi": "/api/billing/webhooks/youpi",
};
const WEBHOOK_TARGETS = new Set(Object.values(WEBHOOK_ROUTES));

/** Top-level folders of public/ (a test keeps this in step with the folder). */
export const PUBLIC_DIRS = ["audio", "brand", "brands", "partners", "samples"]; // R1282: /partners/hand-*.svg
const STATIC_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|css|js|mjs|map|mp3|mp4|webm|wav|ogg|json|webmanifest|txt|xml|pdf|html)$/i;

export type HostRoute =
  | { kind: "pass" }
  | { kind: "serve" }
  | { kind: "next" }
  | { kind: "redirect"; to: string }
  | { kind: "rewrite"; path: string }
  | { kind: "json"; body: Record<string, string> }
  | { kind: "notFound" };

export type HostEnv = { APP_URL?: string; ADMIN_HOST?: string };

const under = (p: string, base: string) => p === base || p.startsWith(base + "/");

/** ADMIN_HOST only counts when it is the admin subdomain this table serves (anything else could loop or lock admins out). */
export function adminHost(env: HostEnv): string | null {
  return hostOf(env.ADMIN_HOST) === ADMIN_SUBDOMAIN ? ADMIN_SUBDOMAIN : null;
}

function isStaticFile(p: string) {
  if (p.startsWith("/_next/static/")) return true;
  if (!STATIC_EXT.test(p)) return false;
  const parts = p.split("/").filter(Boolean);
  if (parts.some((s) => s === "." || s === "..")) return false;
  return parts.length === 1 || PUBLIC_DIRS.includes(parts[0]);
}

/**
 * What a request on `host` for `pathname` (+ `search`, with its "?") should do. `pass`: not a subdomain entry point,
 * normal behaviour. `serve`: handled on this host by the normal page pipeline. `next`: answered on this host as it is
 * (API routes and files, which the page pipeline never handles on www either).
 */
export function routeHost(host: string, pathname: string, search: string, env: HostEnv): HostRoute {
  const base = canonicalBase(env.APP_URL);
  const q = search && search !== "?" ? search : "";

  const mod = REDIRECT_HOSTS[host];
  if (mod) {
    let path = mod.landing;
    if (pathname !== "/" && mod.keep.some((k) => under(pathname, k))) path = pathname;
    else if (pathname !== "/" && mod.prefix) path = mod.prefix + pathname;
    const hash = path.indexOf("#");
    const to = hash < 0 ? path + q : path.slice(0, hash) + q + path.slice(hash);
    return { kind: "redirect", to: base + to };
  }

  if (host === ADMIN_SUBDOMAIN) {
    if (pathname === "/") return { kind: "redirect", to: `https://${ADMIN_SUBDOMAIN}/admin${q}` };
    if (under(pathname, "/admin")) return { kind: "serve" };
    return { kind: "redirect", to: base + pathname + q };
  }

  if (host === API_HOST) {
    if (pathname === "/") return { kind: "json", body: { service: "outlly-api", docs: `${CANONICAL_ORIGIN}/help` } };
    if (under(pathname, "/api")) return { kind: "next" };
    return { kind: "rewrite", path: "/api" + pathname };
  }

  if (host === WEBHOOK_HOST) {
    const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    if (WEBHOOK_TARGETS.has(p)) return { kind: "next" };
    const to = WEBHOOK_ROUTES[p];
    return to ? { kind: "rewrite", path: to } : { kind: "notFound" };
  }

  if (STATIC_HOSTS.includes(host)) return isStaticFile(pathname) ? { kind: "next" } : { kind: "notFound" };

  const admin = adminHost(env);
  if (admin && (host === "www.outlly.com" || host === "outlly.com") && under(pathname, "/admin")) return { kind: "redirect", to: `https://${admin}${pathname}${q}` };

  return { kind: "pass" };
}
