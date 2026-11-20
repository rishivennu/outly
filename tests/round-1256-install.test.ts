/**
 * R1256: the Install Outlly button. The state manager (platform, prompt capture and retention, accepted vs dismissed,
 * installed detection, dismissal cool-down, the guide never counting as an install) against a fake window, the guide
 * copy for each browser, where the button is mounted, and the manifest fields installability depends on.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { INSTALL_KEY, installCaptureScript, parseState } from "../lib/pwa-core";
import { createInstallManager, detectBrowser, detectPlatform, guideKind, isInAppBrowser, isTablet, type BeforeInstallPromptEvent, type InstallWindow } from "../lib/pwa/install";
import { guideFor } from "../components/pwa/InstallGuide";
import manifest from "../app/manifest";

const DAY = 86_400_000;
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
  iosFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
  iosEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0 Mobile/15E148 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

type Fake = InstallWindow & { dispatchEvent: (e: { type: string }) => void; fire: (type: string, e?: unknown) => void; media: Set<string>; store: Map<string, string>; mediaChange: () => void; attrs: Set<string> };
function fakeWindow(o: { ua?: string; platform?: string; touch?: number; standalone?: boolean; search?: string } = {}): Fake {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const media = new Set<string>();
  const store = new Map<string, string>();
  const attrs = new Set<string>();
  let onMedia: (() => void) | null = null;
  const w: Fake = {
    navigator: { userAgent: o.ua ?? UA.android, platform: o.platform ?? "", maxTouchPoints: o.touch ?? 0, standalone: o.standalone },
    document: { documentElement: { hasAttribute: (n) => attrs.has(n) }, referrer: "" },
    location: { search: o.search ?? "" },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    matchMedia: (q) => ({ matches: media.has(q), addEventListener: (_t, f) => (onMedia = f), removeEventListener: () => (onMedia = null) }),
    addEventListener: (t, f) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(f);
    },
    removeEventListener: (t, f) => void listeners.get(t)?.delete(f),
    dispatchEvent: (e) => listeners.get(e.type)?.forEach((f) => f(e as Event)),
    fire: (t, e = { type: t }) => listeners.get(t)?.forEach((f) => f(e as Event)),
    media,
    store,
    attrs,
    mediaChange: () => onMedia?.(),
  };
  return w;
}
function fakePrompt(outcome: "accepted" | "dismissed", opts: { fail?: boolean } = {}) {
  let calls = 0;
  const ev = {
    type: "beforeinstallprompt",
    preventDefault: () => {},
    prompt: async () => {
      calls++;
      if (opts.fail) throw new Error("InvalidStateError");
    },
    userChoice: Promise.resolve({ outcome }),
  } as unknown as BeforeInstallPromptEvent;
  return { ev, calls: () => calls };
}
const stored = (w: Fake) => parseState(w.store.get(INSTALL_KEY));

describe("platform and browser detection", () => {
  test("iPhone, iPad and the iPad that says it is a Mac are all iOS; a real Mac is desktop", () => {
    expect(detectPlatform(UA.iphone)).toBe("ios");
    expect(detectPlatform(UA.ipad)).toBe("ios");
    expect(detectPlatform(UA.ipadDesktop, "MacIntel", 5)).toBe("ios");
    expect(isTablet(UA.ipadDesktop, "MacIntel", 5)).toBe(true);
    expect(isTablet(UA.iphone, "iPhone", 5)).toBe(false);
    expect(detectPlatform(UA.macSafari, "MacIntel", 0)).toBe("desktop");
    expect(detectPlatform(UA.android)).toBe("android");
    expect(detectPlatform(UA.winChrome, "Win32")).toBe("desktop");
  });
  test("browsers", () => {
    expect(detectBrowser(UA.iphone)).toBe("safari");
    expect(detectBrowser(UA.iosChrome)).toBe("chrome");
    expect(detectBrowser(UA.iosFirefox)).toBe("firefox");
    expect(detectBrowser(UA.iosEdge)).toBe("edge");
    expect(detectBrowser(UA.samsung)).toBe("samsung");
    expect(detectBrowser(UA.android)).toBe("chrome");
    expect(detectBrowser(UA.winEdge)).toBe("edge");
    expect(detectBrowser(UA.winFirefox)).toBe("firefox");
    expect(detectBrowser(UA.macSafari)).toBe("safari");
  });
  test("which guide fits", () => {
    expect(guideKind("ios", "safari", false)).toBe("ios-safari");
    expect(guideKind("ios", "chrome", false)).toBe("ios-other");
    expect(guideKind("android", "chrome", false)).toBe("android");
    expect(guideKind("desktop", "chrome", false)).toBe("desktop");
    expect(guideKind("desktop", "safari", false)).toBe("desktop-safari");
    expect(guideKind("desktop", "firefox", false)).toBe("unsupported");
    expect(isInAppBrowser(UA.instagram)).toBe(true);
    expect(isInAppBrowser(UA.iphone)).toBe(false);
    expect(guideKind("ios", "other", true)).toBe("in-app");
  });
  test("the manager's snapshot reports platform, tablet and guide", () => {
    const s = createInstallManager(fakeWindow({ ua: UA.ipadDesktop, platform: "MacIntel", touch: 5 })).getSnapshot();
    expect(s).toMatchObject({ ready: true, platform: "ios", tablet: true, browser: "safari", guide: "ios-safari", needsGuide: true, canPrompt: false, installed: false });
  });
});

describe("the native prompt (Android, desktop Chrome and Edge)", () => {
  test("captured by the head script, kept on window, so a new mount after a route change still has it", () => {
    const w = fakeWindow();
    class Ev {
      constructor(public type: string) {}
    }
    new Function("window", "localStorage", "Event", "location", installCaptureScript)(w, w.localStorage, Ev, { pathname: "/home" });
    const p = fakePrompt("accepted");
    w.fire("beforeinstallprompt", p.ev);
    const first = createInstallManager(w);
    expect(first.getSnapshot().canPrompt).toBe(true);
    expect(w.__outllyInstall).toBe(p.ev);
    first.destroy();
    const again = createInstallManager(w);
    expect(again.getSnapshot()).toMatchObject({ canPrompt: true, needsGuide: false });
    expect(p.calls()).toBe(0);
  });
  test("the manager catches it itself when the head script did not run", () => {
    const w = fakeWindow();
    const m = createInstallManager(w);
    expect(m.getSnapshot().canPrompt).toBe(false);
    let n = 0;
    m.subscribe(() => n++);
    w.fire("beforeinstallprompt", fakePrompt("accepted").ev);
    expect(m.getSnapshot().canPrompt).toBe(true);
    expect(n).toBe(1);
    m.refresh();
    expect(n).toBe(1);
  });
  test("accepted: no strike, the prompt is spent, and installed waits for the browser's appinstalled", async () => {
    const w = fakeWindow();
    const p = fakePrompt("accepted");
    w.__outllyInstall = p.ev;
    const m = createInstallManager(w);
    expect(await m.promptInstall()).toBe("accepted");
    expect(p.calls()).toBe(1);
    expect(w.__outllyInstall).toBe(null);
    expect(m.getSnapshot()).toMatchObject({ outcome: "accepted", installed: false, canPrompt: false });
    expect(stored(w).dismissals).toBe(0);
    w.fire("appinstalled");
    expect(m.getSnapshot()).toMatchObject({ installed: true, justInstalled: true, needsGuide: false });
    expect(stored(w).installed).toBe(true);
  });
  test("dismissed: one strike, a cool-down that doubles, and stopped for good after the third", async () => {
    let now = 1_000 * DAY;
    const w = fakeWindow();
    const m = createInstallManager(w, () => now);
    w.__outllyInstall = fakePrompt("dismissed").ev;
    expect(await m.promptInstall()).toBe("dismissed");
    expect(m.getSnapshot()).toMatchObject({ outcome: "dismissed", dismissed: true, installed: false });
    expect(stored(w).dismissals).toBe(1);
    now += 22 * DAY;
    m.refresh();
    expect(m.getSnapshot().dismissed).toBe(false);
    m.dismissPromotion();
    now += 22 * DAY;
    m.refresh();
    expect(m.getSnapshot().dismissed).toBe(true);
    now += 21 * DAY;
    m.refresh();
    expect(m.getSnapshot().dismissed).toBe(false);
    m.dismissPromotion();
    now += 10_000 * DAY;
    m.refresh();
    expect(m.getSnapshot().dismissed).toBe(true);
  });
  test("cool-down survives a reload (it lives in localStorage)", async () => {
    const now = () => 5_000 * DAY;
    const w = fakeWindow();
    w.__outllyInstall = fakePrompt("dismissed").ev;
    await createInstallManager(w, now).promptInstall();
    expect(createInstallManager(w, now).getSnapshot().dismissed).toBe(true);
  });
  test("no prompt, or one that will not open: unavailable, and no strike", async () => {
    const w = fakeWindow();
    const m = createInstallManager(w);
    expect(await m.promptInstall()).toBe("unavailable");
    w.__outllyInstall = fakePrompt("accepted", { fail: true }).ev;
    expect(await m.promptInstall()).toBe("unavailable");
    expect(stored(w).dismissals).toBe(0);
    expect(m.getSnapshot().installed).toBe(false);
  });
  test("an in-app browser never offers the prompt", () => {
    const w = fakeWindow({ ua: UA.instagram });
    w.__outllyInstall = fakePrompt("accepted").ev;
    expect(createInstallManager(w).getSnapshot()).toMatchObject({ canPrompt: false, guide: "in-app" });
  });
});

describe("already installed", () => {
  test("display-mode standalone", () => {
    const w = fakeWindow();
    w.media.add("(display-mode: standalone)");
    expect(createInstallManager(w).getSnapshot()).toMatchObject({ installed: true, standalone: true, needsGuide: false, canPrompt: false });
    expect(stored(w).installed).toBe(true);
  });
  test("iOS navigator.standalone, and the Android app", () => {
    expect(createInstallManager(fakeWindow({ ua: UA.iphone, standalone: true })).getSnapshot()).toMatchObject({ installed: true, standalone: true });
    const w = fakeWindow();
    w.attrs.add("data-app");
    expect(createInstallManager(w).getSnapshot().installed).toBe(true);
  });
  test("a display-mode change (opened as the app) updates subscribers", () => {
    const w = fakeWindow();
    const m = createInstallManager(w);
    expect(m.getSnapshot().installed).toBe(false);
    let n = 0;
    m.subscribe(() => n++);
    w.media.add("(display-mode: standalone)");
    w.mediaChange();
    expect(n).toBe(1);
    expect(m.getSnapshot().installed).toBe(true);
  });
  test("?source=pwa hides it for that load only and is never stored", () => {
    const w = fakeWindow({ search: "?source=pwa" });
    expect(createInstallManager(w).getSnapshot()).toMatchObject({ installed: true, standalone: false });
    expect(stored(w).installed).toBe(false);
  });
  test("a stored install is dropped when the browser offers the prompt again (it was uninstalled)", () => {
    const w = fakeWindow();
    w.store.set(INSTALL_KEY, JSON.stringify({ installed: true, visits: 4 }));
    expect(createInstallManager(w).getSnapshot().installed).toBe(true);
    w.__outllyInstall = fakePrompt("accepted").ev;
    expect(createInstallManager(w).getSnapshot()).toMatchObject({ installed: false, canPrompt: true });
    expect(stored(w)).toMatchObject({ installed: false, visits: 4 });
  });
});

describe("the guide never counts as an install", () => {
  test("open and close: the guide shows, then pauses promotions, and installed stays false", () => {
    const now = 9_000 * DAY;
    const w = fakeWindow({ ua: UA.iphone });
    const m = createInstallManager(w, () => now);
    m.openGuide();
    expect(m.getSnapshot()).toMatchObject({ guideOpen: true, installed: false });
    m.closeGuide();
    expect(m.getSnapshot()).toMatchObject({ guideOpen: false, installed: false, dismissed: false });
    expect(stored(w)).toMatchObject({ installed: false, guidedAt: now, dismissals: 0 });
    expect(createInstallManager(w, () => now).getSnapshot().installed).toBe(false);
  });
});

describe("guide copy per browser", () => {
  const all = (g: ReturnType<typeof guideFor>) => [g.title, g.lead, g.note ?? "", ...g.steps.flatMap((s) => [s.title, s.body, s.label ?? ""])].join(" ");
  test("iOS: Share, Add to Home Screen, Add, and the Share button where it really is", () => {
    const phone = guideFor("ios-safari", "safari", false);
    expect(phone.steps.map((s) => s.title)).toEqual(["Tap the Share icon", "Select Add to Home Screen", "Tap Add"]);
    expect(phone.steps[0]!.body).toContain("bottom of Safari");
    expect(guideFor("ios-safari", "safari", true).steps[0]!.body).toContain("top right");
    expect(guideFor("ios-other", "chrome").steps[0]!.body).toContain("address bar");
    expect(guideFor("ios-other", "firefox").steps[0]!.body).toContain("bottom right");
    expect(all(phone)).not.toMatch(/install(s|ed)? (itself|automatically)/i);
  });
  test("every guide is honest and has no em-dash", () => {
    const kinds = ["ios-safari", "ios-other", "android", "desktop", "desktop-safari", "unsupported", "in-app"] as const;
    for (const k of kinds) for (const b of ["safari", "chrome", "firefox", "edge", "samsung", "other"] as const) expect(all(guideFor(k, b))).not.toContain("\u2014");
    expect(guideFor("unsupported", "firefox").steps).toHaveLength(0);
    expect(guideFor("unsupported", "firefox").lead).toContain("cannot install");
    expect(guideFor("in-app", "other").lead).toContain("cannot add");
  });
});

describe("where the button lives", () => {
  test("account menu: one small insertion that closes the menu first", () => {
    const a = src("components/shell/AccountMenu.tsx");
    expect(a.match(/<InstallOutllyButton /g)?.length).toBe(1);
    expect(a).toContain('<InstallOutllyButton layout="menu" onPick={onPick} />');
  });
  test("phone drawer: the same menu row under My account, closing the drawer first", () => {
    const d = src("components/shell/MobileDrawer.tsx");
    expect(d.match(/<InstallOutllyButton /g)?.length).toBe(1);
    expect(d).toContain('<InstallOutllyButton layout="menu" onPick={close} />');
    expect(d.indexOf('id="dr-me"')).toBeLessThan(d.indexOf("<InstallOutllyButton "));
  });
  test("Settings > Appearance, which says Outlly is installed once it is", () => {
    const v = src("components/settings/SettingsView.tsx");
    expect(v).toContain("<InstallSettingsCard />");
    expect(src("components/pwa/InstallSettingsCard.tsx")).toContain('<InstallOutllyButton layout="panel" showInstalled');
    expect(src("components/pwa/InstallOutllyButton.tsx")).toContain('"Outlly is installed"');
  });
  test("the Home Screen card uses the same button, hosts the one guide, and keeps its rules", () => {
    const c = src("components/shell/InstallPrompt.tsx");
    expect(c).toContain('<InstallOutllyButton layout="card"');
    expect(c).toContain("<InstallGuideHost />");
    expect(c).not.toContain(".prompt()");
    expect(c).toContain("shouldOffer(read(), config, Date.now())");
    expect(c).toContain("isCalmPage(pathRef.current)");
    expect(c).toContain("installManager()?.dismissPromotion()");
  });
  test("setup checklist reuses InstallOutllyButton and the shared manager, with no install code of its own", () => {
    const c = src("components/onboarding/SetupChecklist.tsx");
    expect(c).toContain('import { InstallOutllyButton } from "@/components/pwa/InstallOutllyButton";');
    expect(c.match(/<InstallOutllyButton /g)?.length).toBe(1);
    expect(c).toContain('<InstallOutllyButton layout="card" className="w-full sm:w-fit" describedBy="setup-note-install" />');
    expect(c).toContain("useInstallState()");
    expect(c).toContain('id={`setup-note-${s.id}`}');
    for (const gone of ["beforeinstallprompt", "__outllyInstall", ".prompt()", "userChoice", "installMode(", "provenInstalled(", "matchMedia", "outly:installable"]) expect(c, gone).not.toContain(gone);
    // the row only shows where there is something to do (prompt in hand, or iOS), never in an in-app browser
    expect(c).toContain('s.installed || s.outcome === "accepted" || (!s.inApp && (s.canPrompt || s.platform === "ios"))');
  });
  test("the button: label, supporting text, lime, prompt only from a click", () => {
    const b = src("components/pwa/InstallOutllyButton.tsx");
    expect(b).toContain('INSTALL_LABEL = "Install Outlly"');
    expect(b).toContain('INSTALL_TEXT = "Get faster access to Outlly directly from your Home Screen."');
    expect(b).toContain('variant="lime"');
    expect(b.match(/promptInstall\(\)/g)?.length).toBe(1);
    expect(b.slice(b.indexOf("const click = async"))).toContain("promptInstall()");
    expect(src("lib/pwa/install.ts")).not.toMatch(/\.prompt\(\)[\s\S]*\.prompt\(\)/);
  });
  test("the guide: safe areas, 44px close, a sheet on phones and a dialog wider, nothing auto-opened", () => {
    const g = src("components/pwa/InstallGuide.tsx");
    for (const side of ["top", "left", "right", "bottom"]) expect(g).toContain(`env(safe-area-inset-${side})`);
    expect(g).toContain("install-sheet fixed inset-x-0 bottom-0");
    expect(g).toContain("sm:inset-0 sm:m-auto");
    expect(g).toMatch(/Dialog\.Close aria-label="Close" className="[^"]*h-11 w-11/);
    expect(g).not.toContain("navigator.share");
    expect(g).toContain("useReducedMotion");
  });
});

describe("manifest and service worker", () => {
  const m = manifest();
  const png = (p: string) => {
    const b = readFileSync(new URL(`../public${p.split("?")[0]}`, import.meta.url));
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  test("names, start URL inside scope, standalone, colours", () => {
    expect(m.name).toBe("Outlly");
    expect(m.short_name).toBe("Outlly");
    expect(m.scope).toBe("/");
    expect(m.start_url!.startsWith(m.scope!)).toBe(true);
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  test("192 and 512 icons are real PNGs of that size, and one is maskable", () => {
    const icons = m.icons ?? [];
    for (const i of icons) {
      expect(existsSync(new URL(`../public${i.src.split("?")[0]}`, import.meta.url))).toBe(true);
      const [wd, ht] = png(i.src);
      expect(`${wd}x${ht}`).toBe(i.sizes!);
    }
    expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  });
  test("one service worker at the root scope, registered from the head and Connectivity, and not behind the middleware", () => {
    expect(src("lib/sw-script.ts")).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(src("public/sw.js")).toMatch(/addEventListener\("fetch"/);
    expect(src("middleware.ts")).toMatch(/js\|css\|woff2\?\|html\|webmanifest\)\$/);
  });
});
