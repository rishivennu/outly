/* Which parts of the landing page are shown. Pure data + helpers (no imports), shared by the landing page,
   the admin table, the status API and the marketing nav/footer. */

export const LANDING_SECTIONS = [
  { id: "hero", anchor: "", label: "Hero", shows: "Headline, sign-up button and the product preview", core: true },
  { id: "try", anchor: "try", label: "Try it", shows: "The live AI box: one idea in, a caption, a Shorts title and a post out" },
  { id: "usp", anchor: "why-outlly", label: "Why Outlly", shows: "The six strengths: captions, publishing, calendar, analytics, inbox and Pip, with the with and without comparison" },
  { id: "how", anchor: "how", label: "How it works", shows: "Three steps from one upload to every platform" },
  { id: "features", anchor: "features", label: "Features", shows: "The feature bento: AI captions, scheduling, tracking" },
  { id: "time", anchor: "time-saved", label: "Time saved", shows: "The time-saved calculator, the visitor's own numbers" },
  { id: "demo", anchor: "demo", label: "Live demo", shows: "The animated upload, tailor and publish flow" },
  { id: "why", anchor: "why", label: "Why it's different", shows: "The differentiation cards" },
  { id: "platforms", anchor: "platforms", label: "Platforms", shows: "Supported destinations and what is coming" },
  { id: "compare", anchor: "compare", label: "Comparison table", shows: "Outlly next to Buffer, Metricool, Later and Hootsuite" },
  { id: "trust", anchor: "trust", label: "Trust", shows: "Real usage numbers (hidden until they are big enough) and how accounts are kept safe" },
  { id: "pricing", anchor: "pricing", label: "Pricing", shows: "Plans, priced for the visitor's country" },
  { id: "faq", anchor: "faq", label: "FAQ", shows: "Straight answers, from the admin FAQ" },
  { id: "cta", anchor: "", label: "Final call to action", shows: "The closing sign-up card above the footer" },
] as const;
export type LandingSection = (typeof LANDING_SECTIONS)[number]["id"];

/** Columns of the comparison table the admin can hide (Outlly's own column always stays). */
export const LANDING_COMPETITORS = [
  { id: "buffer", label: "Buffer" },
  { id: "metricool", label: "Metricool" },
  { id: "later", label: "Later" },
  { id: "hootsuite", label: "Hootsuite" },
] as const;

/** Row groups of the comparison table, by their heading. Must match ROW_GROUPS in lib/marketing/comparison.ts. */
export const LANDING_GROUPS = ["Publishing", "Creating", "Planning and tracking", "Insight and price", "Beyond publishing"] as const;

/**
 * R1310: public pages and menu entries the admin can switch off. `workshops` takes /workshops and every session page
 * down (404) and drops the menu link; `resources` only drops the Resources menu link (help, blog and changelog stay
 * reachable by URL, the help centre is where support links point).
 */
export const PUBLIC_PAGES = [
  { id: "workshops", label: "Workshops page", path: "/workshops", shows: "The Creator Hub: /workshops, every session page and the Workshops link in the menu" },
  { id: "resources", label: "Resources link", path: "/help", shows: "The Resources link in the menu (help centre, blog, changelog). The pages themselves stay up" },
] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number]["id"];

export interface LandingConfig {
  sections: Record<LandingSection, boolean>;
  competitors: Record<string, boolean>;
  groups: Record<string, boolean>;
  pages: Record<PublicPage, boolean>;
}

export const LANDING_DEFAULT: LandingConfig = {
  sections: Object.fromEntries(LANDING_SECTIONS.map((s) => [s.id, true])) as Record<LandingSection, boolean>,
  competitors: Object.fromEntries(LANDING_COMPETITORS.map((c) => [c.id, true])),
  groups: Object.fromEntries(LANDING_GROUPS.map((g) => [g, true])),
  pages: Object.fromEntries(PUBLIC_PAGES.map((p) => [p.id, true])) as Record<PublicPage, boolean>,
};

/** Missing keys count as on, like sections. */
export const pageOn = (cfg: Pick<LandingConfig, "pages"> | null | undefined, id: PublicPage) => cfg?.pages?.[id] !== false;

/** Missing keys count as shown, so a new section appears by default until the admin hides it. */
export const shown = (cfg: LandingConfig | null | undefined, id: LandingSection) => cfg?.sections?.[id] !== false;

/** Anchors (#how, #pricing ...) the nav and footer should drop because their section is hidden. */
export function hiddenAnchors(cfg: LandingConfig | null | undefined): string[] {
  const out: string[] = LANDING_SECTIONS.filter((s) => s.anchor && !shown(cfg, s.id)).map((s) => s.anchor);
  for (const p of PUBLIC_PAGES) if (!pageOn(cfg, p.id)) out.push(p.id); // R1310: the menu drops the Workshops / Resources link the same way
  return out;
}

/** Readable cookie hint ("how.pricing") the middleware keeps in step, so cached pages can trim their links. */
export const LANDING_HINT = "outlly_lh";
