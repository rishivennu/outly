/**
 * Site typefaces (1046). The admin picks one of three sets in Admin > Site fonts; /api/pip-theme serves the
 * matching override so the whole site switches without a deploy. Shared by the server (the stylesheet)
 * and the admin picker (live preview), so no server-only imports here.
 *
 * - current: Bricolage Grotesque headlines, DM Sans body, Instrument Serif italic accent (next/font).
 * - apple:   San Francisco (SF Pro Display / Text) with New York for the accent. Apple doesn't allow
 *            SF to be served from a website, so this is the system stack: Apple devices draw the real
 *            SF and New York, everything else gets its own system UI face (Segoe UI, Roboto).
 * - gopher:  the Go fonts by Bigelow & Holmes (BSD licence, self-hosted from app/fonts/go). One family
 *            for headlines and body, Go Italic as the accent.
 * - jakarta: Plus Jakarta Sans headlines and body (geometric, open, friendly) with Fraunces italic as the
 *            accent. Both OFL, via next/font, not preloaded.
 */
export const FONT_SET_IDS = ["current", "apple", "gopher", "jakarta"] as const;
export type FontSetId = (typeof FONT_SET_IDS)[number];

export interface FontConfig {
  set: FontSetId;
}
export const FONTS_DEFAULT: FontConfig = { set: "current" };

export interface FontSet {
  id: FontSetId;
  name: string;
  hint: string;
  display: string;
  body: string;
  serif: string;
}

const SYS = "system-ui, sans-serif";
export const FONT_SETS: readonly FontSet[] = [
  {
    id: "current",
    name: "Outlly original",
    hint: "Bricolage Grotesque headlines, DM Sans body, Instrument Serif italic for the accent word.",
    display: `var(--font-bricolage), var(--font-dmsans), ${SYS}`,
    body: `var(--font-dmsans), ${SYS}`,
    serif: "var(--font-instrument), Georgia, serif",
  },
  {
    id: "apple",
    name: "Apple (San Francisco)",
    hint: "SF Pro Display and Text with New York for the accent. Real SF on iPhone, iPad and Mac; other devices use their own system font.",
    display: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", ${SYS}`,
    body: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", ${SYS}`,
    serif: `ui-serif, "New York", "Iowan Old Style", Georgia, serif`,
  },
  {
    id: "gopher",
    name: "Go (gopher fonts)",
    hint: "The Go typeface by Bigelow & Holmes, made for the Go project. Friendly, wide and very legible; Go Italic for the accent.",
    display: `var(--font-gopher), ${SYS}`,
    body: `var(--font-gopher), ${SYS}`,
    serif: `var(--font-gopher), ${SYS}`,
  },
  {
    id: "jakarta",
    name: "Jakarta + Fraunces",
    hint: "Plus Jakarta Sans, a crisp geometric sans with open, friendly shapes, and Fraunces italic for the accent word.",
    display: `var(--font-jakarta), ${SYS}`,
    body: `var(--font-jakarta), ${SYS}`,
    serif: "var(--font-fraunces), Georgia, serif",
  },
];

export const fontSetById = (id: string): FontSet => FONT_SETS.find((f) => f.id === id) ?? FONT_SETS[0];

export function normalizeFonts(raw: unknown): FontConfig {
  const v = raw && typeof raw === "object" ? (raw as { set?: unknown }).set : undefined;
  return { set: typeof v === "string" && (FONT_SET_IDS as readonly string[]).includes(v) ? (v as FontSetId) : "current" };
}

/**
 * The override appended to /api/pip-theme. "current" needs none (globals.css maps the roles to the
 * original fonts). :root:root outranks the plain :root mapping. The original headline sizes lean on
 * Bricolage's width axis; the other faces don't have it, so those settings are reset.
 */
export function fontCss(cfg: FontConfig): string {
  const c = normalizeFonts(cfg);
  if (c.set === "current") return "";
  const f = fontSetById(c.set);
  const lines = [
    `:root:root{--font-display:${f.display};--font-body:${f.body};--font-serif:${f.serif}}`,
    `.display,h1,h2,h3,h4,.stamp-mini-big{font-variation-settings:normal}`,
  ];
  // Go is wide with a tall x-height: open headline tracking a little and keep the accent upright-weighted.
  if (c.set === "gopher") lines.push(`.display{letter-spacing:-0.02em}.accent-serif{letter-spacing:-0.005em}`);
  // Jakarta runs a little wide at display sizes; Fraunces italic is already tight.
  if (c.set === "jakarta") lines.push(`.display{letter-spacing:-0.035em}.accent-serif{letter-spacing:-0.01em}`);
  return `/* Site fonts: ${f.name}, from Admin > Site fonts */\n${lines.join("\n")}\n`;
}
