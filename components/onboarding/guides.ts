import type { Stop } from "./Spotlight";

/*
 * First-visit tips, one set per studio page (PageGuide.tsx shows them).
 * Basic guidance, not a manual: up to four stops, one short sentence each. A stop whose target isn't on
 * screen right now (an empty page, a card that only shows on desktop) is skipped; if none are, the page's
 * intro shows as a single centred card instead.
 */

export type Guide = { page: string; name: string; intro: string; stops: Stop[] };

export const GUIDES: Record<string, Guide> = {
  "/home": {
    page: "home",
    name: "Home",
    intro: "Home is where each day starts: what's going out, and what to do next.",
    stops: [
      { target: '[data-guide="home-create"]', title: "Start a post", body: "One video in, a post for every platform out." },
      { target: '[aria-labelledby="setup-h"]', title: "Finish setting up", body: "A short checklist. Tick it off and you're ready to post." },
      { target: '[aria-labelledby="next-h"]', title: "What to do next", body: "Small things worth doing today, picked from your studio." },
      { target: "#goal", title: "Your weekly goal", body: "Pick how many posts a week you're aiming for. The ring fills as you schedule." },
      { target: "#ideas", title: "Idea bank", body: "Save an idea the moment it hits, and turn it into a post later." },
    ],
  },
  "/create": {
    page: "create",
    name: "Create",
    intro: "Create turns one video into a post for every platform, in four steps.",
    stops: [
      { target: 'nav[aria-label="Your journey"]', title: "Four steps", body: "Video, story, everywhere, launch. You can jump back to any step you've reached." },
      { target: '[data-guide="create-upload"]', title: "Drop your video", body: "MP4 or MOV, up to 50 MB. Your work saves as you go." },
      { target: 'aside[aria-label="AI assistant"]', title: "Your assistant", body: "Ask it for a hook, a caption or hashtags while you work." },
    ],
  },
  "/content": {
    page: "content",
    name: "Content",
    intro: "Content keeps everything you've made. Your first post will show up here.",
    stops: [
      { target: '[aria-label="Filter by status"]', title: "Filter by status", body: "Switch between drafts, scheduled, sent and failed posts." },
      { target: '[aria-label$=". Open details"]', title: "Open a post", body: "Tap any post to see where it went, edit it, or duplicate it." },
    ],
  },
  "/calendar": {
    page: "calendar",
    name: "Calendar",
    intro: "Calendar shows what goes out when.",
    stops: [
      { target: '[data-guide="cal-weeks"]', title: "Move between weeks", body: "Use the arrows, or Today to jump back to this week." },
      { target: '[data-guide="cal-grid"]', title: "Drag to reschedule", body: "Drag a scheduled post onto another day to move it." },
      { target: 'a[href="/create/bulk"]', title: "Plan a batch", body: "Drop up to 10 videos and Outlly spreads them over the coming days at good times." },
    ],
  },
  "/analytics": {
    page: "analytics",
    name: "Analytics",
    intro: "Analytics shows how your posts are doing. Connect an account and the numbers show up here.",
    stops: [
      { target: 'nav[aria-label="Analytics views"]', title: "One tab per platform", body: "The overview first, then a full dashboard for each connected account." },
      { target: '[aria-label="Time range"]', title: "Pick a range", body: "Look at the last 7, 30 or 90 days." },
      { target: '[aria-labelledby="trend"]', title: "Views over time", body: "How your views moved across that range." },
      { target: '[aria-labelledby="live-strip"]', title: "Live numbers", body: "Fresh numbers straight from each platform." },
    ],
  },
  "/inbox": {
    page: "inbox",
    name: "Inbox",
    intro: "Inbox collects comments and messages from your connected platforms, so you can reply in one place.",
    stops: [
      { target: '[role="tablist"][aria-label="Inbox"]', title: "Comments and messages", body: "Switch between replies on your posts and direct messages." },
      { target: ".reply-ideas", title: "Suggested replies", body: "Tap one to fill it in, change anything you like, then send." },
    ],
  },
  "/approvals": {
    page: "approvals",
    name: "Approvals",
    intro: "Approvals lets a client or teammate check a post before it goes out. Turn on \"Needs approval\" in any post, then send the review link.",
    stops: [
      { target: '[aria-labelledby="lane-needs"]', title: "Needs a reviewer", body: "Posts with approval on that nobody has a link for yet." },
      { target: '[aria-labelledby="lane-changes"]', title: "Changes requested", body: "Read the note, fix the post, and send a fresh link." },
      { target: '[aria-labelledby="lane-approved"]', title: "Approved", body: "Cleared posts go out on schedule." },
    ],
  },
  "/accounts": {
    page: "accounts",
    name: "Connected accounts",
    intro: "Connect the platforms you post to.",
    stops: [
      { target: '[data-guide="acct-first"]', title: "Connect a platform", body: "You sign in on the platform's own page, so Outlly never sees your password." },
      { target: '[aria-labelledby="soon"]', title: "Coming soon", body: "More platforms are on the way. They'll show up here." },
    ],
  },
  "/billing": {
    page: "billing",
    name: "Billing",
    intro: "Billing has your plan, usage and invoices.",
    stops: [
      { target: '[aria-labelledby="cur"]', title: "Your plan", body: "What you're on, and when it renews." },
      { target: '[role="progressbar"][aria-labelledby="usage-l"]', title: "Usage", body: "How much of this month's allowance you've used." },
      { target: '[aria-labelledby="plans"]', title: "Change plan", body: "Upgrade or switch any time." },
      { target: '[aria-labelledby="inv"]', title: "Invoices", body: "Every payment, ready to download as a PDF." },
    ],
  },
  "/support": {
    page: "support",
    name: "Help centre",
    intro: "The Help centre has answers, guides and a way to reach us.",
    stops: [
      { target: 'input[type="search"]', title: "Search help", body: "Type a question to find the answer." },
      { target: '[aria-labelledby="help-quick"]', title: "Quick help", body: "Ask a quick question or write to us. Your requests and our replies stay here." },
    ],
  },
  "/settings": {
    page: "settings",
    name: "Settings",
    intro: "Settings is where you make Outlly yours.",
    stops: [
      // 1053: one category shows at a time, so the stops point at the menu (the "Category" button on a phone).
      { target: '[data-settings-nav="profile"], #settings-nav > button', title: "Profile", body: "Your name, time zone and avatar. Posts are scheduled in this time zone." },
      { target: '[data-settings-nav="appearance"], #settings-nav > button', title: "Appearance", body: "Light, dark, or match your device." },
      { target: '[data-settings-nav="security"], #settings-nav > button', title: "Security", body: "Two-step sign-in and remembered devices. A code at sign-in keeps others out." },
      { target: '[data-settings-nav="personalization"], #settings-nav > button', title: "Replay the tour", body: "Under Personalization: bring back the tour and these page tips any time." },
    ],
  },
};

export const MAX_STOPS = 4;

export const guideKey = (page: string, userId: string) => `outly:guide-done:${page}:${userId}`;
export const guidesOffKey = (userId: string) => `outly:guides-off:${userId}`;

/** Live state of the welcome tour, so a page's tips never stack on it. */
export const tourState = { open: false, ranOn: null as string | null };

/** Bring every page's tips back (replaying the tour does this). */
export function resetGuides(userId: string) {
  try {
    localStorage.removeItem(guidesOffKey(userId));
    for (const g of Object.values(GUIDES)) localStorage.removeItem(guideKey(g.page, userId));
  } catch {
    /* storage blocked: tips just won't come back */
  }
}

/** The stops that can point at something right now, at most four; else one centred intro card. */
export function presentStops(g: Guide, has: (target: string) => boolean): Stop[] {
  const found = g.stops.filter((s) => !s.target || has(s.target)).slice(0, MAX_STOPS);
  return found.length ? found : [{ title: g.name, body: g.intro }];
}
