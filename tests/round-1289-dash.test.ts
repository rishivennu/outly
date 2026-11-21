/** R1289 DASH: the creator-facing "My Partnerships" dashboard (nav, list, detail, timeline, offer, deliverables). */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Handshake } from "lucide-react";
import { ANIM, MAIN, accountItems, pageTitle, workspaceItems } from "../components/shell/nav-items";
import { ANIMATED } from "../components/icons/animated/index";
import { TAB_PAGES } from "../lib/client/tab-bar";
import { isAppPath } from "../lib/client/routes";
import { STUDIO_RE } from "../lib/pwa-core";
import { API, APPLY_HREF, STAGE_COPY, canSubmitLink, deliverableProgress, detailPath, expiryLabel, nextActionHref, nextActionLabel, offerTerms, timelineStages } from "../components/partnerships/model";
import type { MineApplication, MineDeliverable, MineEvent, MineOffer } from "../lib/partners/mine-types";

const read = (p: string) => readFileSync(p, "utf8");
const HREF = "/dashboard/partnerships";
const PAGES = "app/(studio)/dashboard";

const ev = (at: string, from: string | null, to: string | null, message = "", action = "status"): MineEvent => ({ at, action, from, to, message });
const app = (status: string, events: MineEvent[] = [], extra: Partial<MineApplication> = {}) =>
  ({ status, createdAt: "2026-11-01T10:00:00.000Z", events, decisionMessage: "", infoRequest: null, ...extra }) as Pick<MineApplication, "status" | "createdAt" | "events" | "decisionMessage" | "infoRequest">;

const offer: MineOffer = {
  id: "of1", status: "sent", version: 2, type: "paid", typeLabel: "Paid collaboration", amountMinor: 1500000, currency: "INR", amountLabel: "₹15,000", paymentTerms: "50% upfront",
  planSlug: "creator", planName: "Creator", subscriptionDays: 90, durationLabel: "3 months", startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2027-02-28T00:00:00.000Z",
  deliverables: 3, platforms: ["instagram", "youtube"], format: "Reels", deadlines: "One a month", disclosure: true, usageRights: "Organic reposts for 6 months", conditions: "",
  expiresAt: "2026-12-05T00:00:00.000Z", sentAt: "2026-11-20T00:00:00.000Z", respondedAt: null, decision: "", declineReason: "",
};

describe("R1289 nav: My Partnerships everywhere except the phone tab bar", () => {
  test("sidebar Workspace group has it before Help centre, for owners and teammates, with the Handshake icon", () => {
    for (const teammate of [false, true]) {
      const items = workspaceItems(teammate);
      const i = items.findIndex((x) => x.href === HREF);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(items[i].label).toBe("My Partnerships");
      expect(items[i].icon).toBe(Handshake);
      expect(items[i + 1].href).toBe("/support");
    }
  });
  test("account menu / phone drawer 'more' list has it before Help & Support", () => {
    for (const teammate of [false, true]) {
      const more = accountItems(teammate).more;
      const i = more.findIndex((x) => x.href === HREF);
      expect(more[i].icon).toBe(Handshake);
      expect(more[i + 1].label).toBe("Help & Support");
    }
  });
  test("phone tab bar and main list stay as they were", () => {
    expect((TAB_PAGES as readonly string[]).includes(HREF)).toBe(false);
    expect(MAIN.some((m) => m.href.startsWith("/dashboard"))).toBe(false);
  });
  test("rail animated icon, page title and the native app More sheet", () => {
    expect(ANIM[HREF]).toBe("partnerships");
    expect(ANIMATED.partnerships).toBeDefined();
    expect(pageTitle(HREF)).toBe("Partnerships");
    expect(pageTitle(`${HREF}/OP-ABC123`)).toBe("Partnerships");
    expect(read("components/shell/AppChrome.tsx")).toContain('{ href: "/dashboard/partnerships", label: "My Partnerships", icon: Handshake');
    expect(read("components/shell/CommandPalette.tsx")).toContain('href: "/dashboard/partnerships"');
  });
  test("the route is a studio route for the session wall, the service worker, the app-path list and PWA", () => {
    expect(read("middleware.ts")).toMatch(/const STUDIO = \[[^\]]*"\/dashboard"\]/);
    expect(read("public/sw.js")).toMatch(/const STUDIO = \/\^\\\/\([^)]*\|dashboard\)/);
    expect(isAppPath(HREF)).toBe(true);
    expect(STUDIO_RE.test(HREF)).toBe(true);
  });
});

describe("R1289 pages", () => {
  test("files exist; /dashboard redirects to /home", () => {
    for (const f of ["page.tsx", "partnerships/page.tsx", "partnerships/[ref]/page.tsx", "partnerships/loading.tsx"]) expect(existsSync(join(PAGES, f))).toBe(true);
    expect(read(`${PAGES}/page.tsx`)).toContain('redirect("/home")');
  });
  test("list reads listMine for the signed-in user and passes ?new= on", () => {
    const s = read(`${PAGES}/partnerships/page.tsx`);
    expect(s).toContain('import { listMine } from "@/lib/partners/mine"');
    expect(s).toContain("listMine(user)");
    expect(s).toContain("Your Creator Partnerships");
    expect(s).toContain("Track your applications, review partnership offers, and manage your collaborations with Outlly.");
    expect(s).toMatch(/sp\.new/);
  });
  test("detail reads getMine and 404s for anything not owned", () => {
    const s = read(`${PAGES}/partnerships/[ref]/page.tsx`);
    expect(s).toContain('import { getMine } from "@/lib/partners/mine"');
    expect(s).toMatch(/if \(!app\) notFound\(\)/);
  });
  test("?new= marks the card, toasts once and leaves the address bar", () => {
    const s = read("components/partnerships/PartnershipsList.tsx");
    expect(s).toContain("Just submitted");
    expect(s).toContain("told.current");
    expect(s).toContain('url.searchParams.delete("new")');
    expect(s).toContain("No applications yet");
    expect(s).toContain("Partner with us");
    expect(APPLY_HREF).toBe("/partners#partners-apply");
    for (const label of ["Applications Submitted", "Under Review", "Offers Received", "Active Partnerships"]) expect(s).toContain(label);
  });
});

describe("R1289 timeline", () => {
  test("fresh application: Submitted is current, the rest are future, More information is hidden", () => {
    const st = timelineStages(app("submitted"));
    expect(st.map((s) => s.key)).toEqual(["submitted", "under_review", "approved", "offer_sent", "offer_accepted", "active", "completed"]);
    expect(st.map((s) => s.state)).toEqual(["current", "future", "future", "future", "future", "future", "future"]);
    expect(st[0].copy).toBe("Your application has been received.");
  });
  test("more_info appears only when asked, as current, with the team's message", () => {
    const st = timelineStages(app("more_info", [ev("2026-11-02", "submitted", "under_review"), ev("2026-11-03", "under_review", "more_info", "Send a screenshot of reach")], { infoRequest: { requestedAt: "2026-11-03", message: "Send a screenshot of reach", respondedAt: null } }));
    const m = st.find((s) => s.key === "more_info")!;
    expect(m.state).toBe("current");
    expect(m.note).toBe("Send a screenshot of reach");
    expect(st.filter((s) => s.state === "done").map((s) => s.key)).toEqual(["submitted", "under_review"]);
  });
  test("answered and back in review: More information reads as done, before Under Review", () => {
    const st = timelineStages(app("under_review", [ev("2026-11-03", "submitted", "more_info"), ev("2026-11-04", "more_info", "under_review")]));
    expect(st.slice(0, 3).map((s) => [s.key, s.state])).toEqual([["submitted", "done"], ["more_info", "done"], ["under_review", "current"]]);
  });
  test("active: everything up to it done, completed future", () => {
    const st = timelineStages(app("active"));
    expect(st.find((s) => s.key === "active")!.state).toBe("current");
    expect(st.find((s) => s.key === "offer_accepted")!.state).toBe("done");
    expect(st.at(-1)!.state).toBe("future");
  });
  test("rejected ends the line with the customer-facing explanation and nothing after it", () => {
    const st = timelineStages(app("rejected", [ev("2026-11-02", "submitted", "under_review"), ev("2026-11-05", "under_review", "rejected", "Audience outside our markets")], { decisionMessage: "Audience outside our markets" }));
    expect(st.map((s) => s.key)).toEqual(["submitted", "under_review", "rejected"]);
    expect(st.at(-1)).toMatchObject({ state: "ended", note: "Audience outside our markets", label: "Rejected" });
  });
  test("withdrawn after an offer keeps the stages it reached", () => {
    const st = timelineStages(app("withdrawn", [ev("2026-11-08", "offer_sent", "withdrawn")]));
    expect(st.map((s) => s.key)).toEqual(["submitted", "under_review", "approved", "offer_sent", "withdrawn"]);
  });
  test("creator copy matches the spec for every stage", () => {
    expect(STAGE_COPY.under_review).toBe("Our team is reviewing your creator profile and engagement.");
    expect(STAGE_COPY.more_info).toBe("Our team needs additional information.");
    expect(STAGE_COPY.approved).toBe("Your application has been approved.");
    expect(STAGE_COPY.offer_sent).toBe("A partnership offer is waiting for your response.");
    expect(STAGE_COPY.offer_accepted).toBe("You have accepted the collaboration terms.");
    expect(STAGE_COPY.active).toBe("Your collaboration is active.");
    expect(STAGE_COPY.completed).toBe("Your partnership has been completed.");
  });
  test("timeline is an ordered list with aria-current=step, never a fake percentage", () => {
    const s = read("components/partnerships/Timeline.tsx");
    expect(s).toContain("<ol");
    expect(s).toContain('aria-current={live ? "step" : undefined}');
    expect(s).not.toMatch(/progressbar|\{[^}]*\}%|pct/);
  });
});

describe("R1289 offer, deliverables, actions", () => {
  test("offer terms list every agreed term", () => {
    const t = offerTerms(offer).map((r) => r.term);
    expect(t).toEqual(["Partnership type", "Paid compensation", "Payment terms", "Complimentary Creator subscription", "Required platforms", "Deliverables", "Format", "Timeline", "Deadlines", "Disclosure", "Usage rights", "Offer expires"]);
    expect(offerTerms(offer).find((r) => r.term === "Required platforms")!.value).toBe("Instagram, YouTube");
    expect(offerTerms(offer).find((r) => r.term === "Complimentary Creator subscription")!.value).toBe("Creator, 3 months");
  });
  test("expiry countdown", () => {
    const now = Date.parse("2026-12-01T00:00:00.000Z");
    expect(expiryLabel(offer.expiresAt, now)).toBe("Expires in 4 days");
    expect(expiryLabel("2026-12-01T05:30:00.000Z", now)).toBe("Expires in 5 hours");
    expect(expiryLabel("2026-11-30T00:00:00.000Z", now)).toBe("Expired");
    expect(expiryLabel(null, now)).toBe("");
  });
  test("accepting needs the full-terms sheet and the 'I accept these terms' tick", () => {
    const s = read("components/partnerships/OfferCard.tsx");
    expect(s).toContain("<Sheet");
    expect(s).toContain("I accept these terms");
    expect(s).toContain("disabled={!agree || busy}");
    expect(s).toContain("Accept Offer");
    expect(s).toContain("Decline Offer");
    expect(s).toContain("API.offer(appRef, offer.id)");
    expect(s).toContain("declineReason");
  });
  test("API paths are the CORE routes, and every action goes through one same-origin POST helper", () => {
    expect(API.list).toBe("/api/me/partnerships");
    expect(API.info("OP-ABC123")).toBe("/api/me/partnerships/OP-ABC123/info");
    expect(API.offer("OP-ABC123", "of1")).toBe("/api/me/partnerships/OP-ABC123/offers/of1");
    expect(API.deliverable("OP-ABC123", "d1")).toBe("/api/me/partnerships/OP-ABC123/deliverables/d1");
    expect(API.withdraw("OP-ABC123")).toBe("/api/me/partnerships/OP-ABC123/withdraw");
    const hook = read("components/partnerships/useAction.ts");
    expect(hook).toContain('api(url, { method: "POST", json })');
    expect(hook).toContain("router.refresh()");
    expect(hook).toContain("inFlight.current");
    expect(read("lib/client/api.ts")).toContain('credentials: "same-origin"');
    expect(read("components/partnerships/MoreInfoPanel.tsx")).toContain("API.info(appRef)");
    expect(read("components/partnerships/ActivePartnership.tsx")).toContain("API.deliverable(appRef, d.id)");
    expect(read("components/partnerships/Withdraw.tsx")).toContain("API.withdraw(appRef)");
  });
  test("deliverable progress and when a link can be sent", () => {
    const d = (status: MineDeliverable["status"]): MineDeliverable => ({ id: status, title: "Reel", platform: "instagram", format: "reels", dueAt: null, publishedAt: null, url: "", status, approval: "none", creatorNote: "" });
    expect(deliverableProgress([d("planned"), d("published"), d("verified"), d("missed")])).toEqual({ done: 2, remaining: 2, total: 4, pct: 50 });
    expect(deliverableProgress([])).toEqual({ done: 0, remaining: 0, total: 0, pct: 0 });
    expect(canSubmitLink(d("planned"))).toBe(true);
    expect(canSubmitLink(d("verified"))).toBe(false);
  });
  test("a card's main button goes to the part of the detail page that needs the creator", () => {
    const a = (kind: MineApplication["nextAction"]["kind"], label = "") => ({ ref: "OP-ABC123", nextAction: { kind, label } });
    expect(detailPath("OP-ABC123")).toBe("/dashboard/partnerships/OP-ABC123");
    expect(nextActionHref(a("respond_info"))).toBe("/dashboard/partnerships/OP-ABC123#more-info");
    expect(nextActionHref(a("review_offer"))).toBe("/dashboard/partnerships/OP-ABC123#offer");
    expect(nextActionHref(a("submit_deliverables"))).toBe("/dashboard/partnerships/OP-ABC123#deliverables");
    expect(nextActionLabel(a("review_offer", "Review your offer"))).toBe("Review your offer");
    expect(nextActionLabel(a("withdraw", "Withdraw application"))).toBe("View details");
    expect(nextActionLabel(a("none"))).toBe("View details");
  });
  test("creator view never shows admin notes and the copy has no em-dashes", () => {
    const dir = "components/partnerships";
    const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).map((f) => join(dir, f));
    files.push(...["page.tsx", "partnerships/page.tsx", "partnerships/[ref]/page.tsx", "partnerships/loading.tsx"].map((f) => join(PAGES, f)));
    for (const f of files) {
      const s = read(f);
      expect({ f, dash: s.includes("\u2014") }).toEqual({ f, dash: false });
      expect({ f, notes: /PartnerNote|partnerNote|adminNote/.test(s) }).toEqual({ f, notes: false });
      expect({ f, all: s.includes("transition-all") }).toEqual({ f, all: false });
    }
  });
});
