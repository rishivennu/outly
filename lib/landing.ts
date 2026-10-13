/* Which parts of the landing page are shown. Pure data + helpers (no imports), shared by the landing page,
   the admin table, the status API and the marketing nav/footer. */

export const LANDING_SECTIONS = [
  { id: "hero", anchor: "", label: "Hero", shows: "Headline, sign-up button and the product preview", core: true },
  { id: "how", anchor: "how", label: "How it works", shows: "Three steps from one upload to every platform" },
  { id: "features", anchor: "features", label: "Features", shows: "The feature bento: AI captions, scheduling, tracking" },
  { id: "demo", anchor: "demo", label: "Live demo", shows: "The animated upload, tailor and publish flow" },
  { id: "why", anchor: "why", label: "Why it's different", shows: "The differentiation cards" },
  { id: "platforms", anchor: "platforms", label: "Platforms", shows: "Supported destinations and what is coming" },
  { id: "compare", anchor: "compare", label: "Comparison table", shows: "Outlly next to Buffer, Metricool, Later and Hootsuite" },
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

export interface LandingConfig {
  sections: Record<LandingSection, boolean>;
  competitors: Record<string, boolean>;
  groups: Record<string, boolean>;
}

export const LANDING_DEFAULT: LandingConfig = {
  sections: Object.fromEntries(LANDING_SECTIONS.map((s) => [s.id, true])) as Record<LandingSection, boolean>,
  competitors: Object.fromEntries(LANDING_COMPETITORS.map((c) => [c.id, true])),
  groups: Object.fromEntries(LANDING_GROUPS.map((g) => [g, true])),
};

/** Missing keys count as shown, so a new section appears by default until the admin hides it. */
export const shown = (cfg: LandingConfig | null | undefined, id: LandingSection) => cfg?.sections?.[id] !== false;

/** Anchors (#how, #pricing ...) the nav and footer should drop because their section is hidden. */
export function hiddenAnchors(cfg: LandingConfig | null | undefined): string[] {
  const out: string[] = LANDING_SECTIONS.filter((s) => s.anchor && !shown(cfg, s.id)).map((s) => s.anchor);
  return out;
}

/** Readable cookie hint ("how.pricing") the middleware keeps in step, so cached pages can trim their links. */
export const LANDING_HINT = "outlly_lh";
