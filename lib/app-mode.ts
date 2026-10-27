export const APP_PACKAGE = "com.outlly.app";
export const APP_SOURCE = "twa";
export const APP_FLAG = "outlly_app";

/*
 * Google Play only allows digital subscriptions bought through Play Billing, so the Android app never shows
 * plans, prices or upgrade buttons. Flip this only once Play Billing (or India's user-choice billing) is wired.
 */
export const APP_SELLS_PLANS = false;

/** Appended to the WebView user agent by the Android app (outlly-app/capacitor.config.json). */
export const NATIVE_UA = "OutllyApp/";

export function isNativeUA(ua: string | null | undefined) {
  return !!ua && ua.includes(NATIVE_UA);
}

/*
 * Runs in <head> before first paint. The native app (Capacitor) is known by its user agent and also gets
 * data-shell="native" for the few things only it can do. The older TWA opens /home?source=twa and Chrome
 * reports it as the referrer. sessionStorage (one per app tab, never shared with the Chrome browser) keeps
 * the flag across navigations, so the app look never leaks into the same person's normal Chrome tabs.
 */
export const appScript = `try{var d=document.documentElement,s=sessionStorage,k="${APP_FLAG}",n=navigator.userAgent.indexOf("${NATIVE_UA}")>=0;if(n)d.setAttribute("data-shell","native");if(n||s.getItem(k)==="1"||/[?&]source=${APP_SOURCE}(&|$)/.test(location.search)||document.referrer.indexOf("android-app://${APP_PACKAGE}")===0){s.setItem(k,"1");d.setAttribute("data-app","android")}}catch(e){}`;

export function isApp() {
  return typeof document !== "undefined" && document.documentElement.dataset.app === "android";
}

export type AppNav = "push" | "pop" | "fade" | "sheet" | "none";

const TAB_ROOTS = ["/home", "/calendar", "/inbox", "/analytics"];

const depth = (p: string) => p.split("/").filter(Boolean).length;
const isTabRoot = (p: string) => TAB_ROOTS.includes(p);

/** How a screen should arrive, iOS style: tabs cross-fade, Create rises as a sheet, deeper screens push, Back pops. */
export function appNavKind(from: string | null, to: string, back: boolean): AppNav {
  if (from === null || from === to) return "none";
  if (to.startsWith("/create") && !from.startsWith("/create")) return "sheet";
  if (back) return "pop";
  if (isTabRoot(to) && (isTabRoot(from) || from.startsWith("/create"))) return "fade";
  return depth(to) > depth(from) || !isTabRoot(to) ? "push" : "fade";
}

const TITLES: Record<string, string> = {
  home: "Home", calendar: "Calendar", inbox: "Inbox", analytics: "Analytics", content: "Content",
  approvals: "Approvals", accounts: "Accounts", settings: "Settings", support: "Help", billing: "Plan", mascot: "Pip", create: "New post",
};

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", x: "X", facebook: "Facebook", threads: "Threads", linkedin: "LinkedIn",
};

/** Large-title text and the parent screen a Back button returns to. */
export function appTitle(path: string): { title: string; parent: { href: string; label: string } | null } {
  const [root, sub] = path.split("/").filter(Boolean);
  const title = TITLES[root ?? "home"] ?? "Outlly";
  if (!sub) return { title, parent: null };
  if (root === "create" && sub === "bulk") return { title: "Bulk plan", parent: { href: "/create", label: "New post" } };
  return { title: PLATFORM_NAMES[sub] ?? sub.charAt(0).toUpperCase() + sub.slice(1), parent: { href: `/${root}`, label: title } };
}
