/**
 * Site typefaces (1046). The admin picks one of seven sets in Admin > Site fonts; /api/pip-theme serves the
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
 * - editorial: Acumin Pro headlines and body with a bold Times New Roman italic accent (1063). Acumin is an
 *            Adobe Fonts licence and can't be self-hosted, so Archivo (OFL) stands in unless the visitor has
 *            Acumin installed. Times New Roman is a system font on Windows, macOS and iOS; Tinos (Apache,
 *            metric-compatible) draws it everywhere else.
 * - poster:  Magnode-style chunky headlines with an Alpha Lyrae-style mono accent (1063). Both are paid
 *            foundry fonts, so Rubik (OFL, 300-900) and Space Mono italic (OFL) stand in unless installed.
 */
export const FONT_SET_IDS = ["current", "classic", "apple", "gopher", "jakarta", "editorial", "poster"] as const;
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
  /** How headlines are set in this face (the same values fontCss / globals.css use), for the admin preview. */
  look: { weight: number; tracking: string; leading: number; axes?: string };
  /** The accent word, when it isn't the usual regular italic (fontCss and the admin preview). */
  accent?: { weight: number; tracking: string };
}

const SYS = "system-ui, sans-serif";
export const FONT_SETS: readonly FontSet[] = [
  {
    id: "current",
    name: "Outlly (Manrope + Inter)",
    hint: "Manrope headlines, Inter body, Instrument Serif italic for the accent word. The default since 1062.",
    display: `var(--font-manrope), var(--font-inter), ${SYS}`,
    body: `var(--font-inter), ${SYS}`,
    serif: "var(--font-instrument), Georgia, serif",
    look: { weight: 700, tracking: "-0.032em", leading: 1.08 },
  },
  {
    id: "classic",
    name: "Outlly classic",
    hint: "The pre-1062 pair: Bricolage Grotesque headlines, a touch condensed, DM Sans body, Instrument Serif accent.",
    display: `var(--font-bricolage), var(--font-dmsans), ${SYS}`,
    body: `var(--font-dmsans), ${SYS}`,
    serif: "var(--font-instrument), Georgia, serif",
    look: { weight: 650, tracking: "-0.028em", leading: 1.02, axes: '"wdth" 96, "opsz" 72' },
  },
  {
    id: "apple",
    name: "Apple (San Francisco)",
    hint: "SF Pro Display and Text with New York for the accent. Real SF on iPhone, iPad and Mac; other devices use their own system font.",
    display: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", ${SYS}`,
    body: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", ${SYS}`,
    serif: `ui-serif, "New York", "Iowan Old Style", Georgia, serif`,
    look: { weight: 700, tracking: "-0.032em", leading: 1.08 },
  },
  {
    id: "gopher",
    name: "Go (gopher fonts)",
    hint: "The Go typeface by Bigelow & Holmes, made for the Go project. Friendly, wide and very legible; Go Italic for the accent.",
    display: `var(--font-gopher), ${SYS}`,
    body: `var(--font-gopher), ${SYS}`,
    serif: `var(--font-gopher), ${SYS}`,
    look: { weight: 700, tracking: "-0.02em", leading: 1.08 },
  },
  {
    id: "jakarta",
    name: "Jakarta + Fraunces",
    hint: "Plus Jakarta Sans, a crisp geometric sans with open, friendly shapes, and Fraunces italic for the accent word.",
    display: `var(--font-jakarta), ${SYS}`,
    body: `var(--font-jakarta), ${SYS}`,
    serif: "var(--font-fraunces), Georgia, serif",
    look: { weight: 700, tracking: "-0.035em", leading: 1.08 },
  },
  {
    id: "editorial",
    name: "Acumin Pro + Times New Roman",
    hint: "Clean grotesque headlines with a heavy Times New Roman italic accent, the \"simply stunning\" look. Archivo stands in for Acumin Pro (an Adobe licence), Tinos for Times where it isn't installed.",
    display: `"Acumin Pro", var(--font-archivo), ${SYS}`,
    body: `"Acumin Pro", var(--font-archivo), ${SYS}`,
    serif: `"Times New Roman", var(--font-tinos), Times, serif`,
    look: { weight: 700, tracking: "-0.035em", leading: 1.04 },
    accent: { weight: 700, tracking: "-0.045em" },
  },
  {
    id: "poster",
    name: "Magnode + Alpha Lyrae",
    hint: "Chunky, heavy poster headlines with a slanted mono accent. Rubik Black stands in for Magnode and Space Mono italic for Alpha Lyrae (both paid foundry fonts) unless installed.",
    display: `"Magnode", var(--font-rubik), ${SYS}`,
    body: `var(--font-rubik), ${SYS}`,
    serif: `"Alpha Lyrae", var(--font-spacemono), ui-monospace, monospace`,
    look: { weight: 900, tracking: "-0.03em", leading: 0.98 },
    accent: { weight: 400, tracking: "-0.04em" },
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
  // Classic: Bricolage's width and optical axes, and the tighter headline set it was tuned with.
  if (c.set === "classic")
    lines.splice(1, 1, `.display{font-weight:650;font-variation-settings:"wdth" 96,"opsz" 72;letter-spacing:-0.028em;line-height:1.02}h1,h2,h3,h4{font-variation-settings:"wdth" 96;letter-spacing:-0.02em}`);
  // Go is wide with a tall x-height: open headline tracking a little and keep the accent upright-weighted.
  if (c.set === "gopher") lines.push(`.display{letter-spacing:-0.02em}.accent-serif{letter-spacing:-0.005em}`);
  // Jakarta runs a little wide at display sizes; Fraunces italic is already tight.
  if (c.set === "jakarta") lines.push(`.display{letter-spacing:-0.035em}.accent-serif{letter-spacing:-0.01em}`);
  // 1063 sets: the headline setting and accent weight come straight from the set (same values the admin preview uses).
  if (c.set === "editorial" || c.set === "poster") {
    lines.push(`.display{font-weight:${f.look.weight};letter-spacing:${f.look.tracking};line-height:${f.look.leading}}`);
    if (f.accent) lines.push(`.accent-serif{font-weight:${f.accent.weight};letter-spacing:${f.accent.tracking}}`);
  }
  // Poster: Rubik's h2-h4 read best a step heavier, to sit with the black headlines; Black closes up the word gaps, so open them a touch.
  if (c.set === "poster") lines.push(`h2,h3,h4{font-weight:700}.display{word-spacing:0.08em}`);
  return `/* Site fonts: ${f.name}, from Admin > Site fonts */\n${lines.join("\n")}\n`;
}
