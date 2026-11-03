/**
 * 1105: the colour the phone paints behind its status bar (meta theme-color: iOS 15+ Safari and Home Screen apps,
 * Android Chrome and installed apps). It has to be the page background, or the time and battery sit on a strip of
 * another colour. These ARE the --background tokens in app/globals.css (light 216 28% 97%, dark 240 6% 5%) as hex;
 * tests/round-1105-bars.test.ts converts the tokens the way browsers do and fails on any difference, even 1 in 255
 * (1107: light was #f5f7fa, one step bluer than the page, which renders #f5f7f9). Hex because older Android
 * and iOS builds ignore hsl() in theme-color.
 */
export const THEME_COLOR = { light: "#f5f7f9", dark: "#0c0c0e" } as const;

/**
 * 1107: the theme choice also lives in this cookie (same name as the localStorage key), so the server can write the
 * right theme-color into the first HTML. An iPhone Home Screen app takes its status bar colour from the page as it
 * arrives and does not reliably follow a later change, so a light user saw a dark strip behind the clock.
 */
export const THEME_COOKIE = "outly-theme";
export const THEME_COOKIE_AGE = 60 * 60 * 24 * 365;

/** The theme-color for a saved choice. System (and anyone not on light or dark) gets one tag per OS appearance. */
export function themeColorFor(choice: string | undefined) {
  if (choice === "light") return THEME_COLOR.light;
  if (choice === "dark" || choice === undefined) return THEME_COLOR.dark; // dark is Outlly's default theme
  return [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ];
}

/** One coordinated theme switch (1105): the whole page cross-fades on Outlly's curve. */
export const THEME_SWITCH_MS = 400;
