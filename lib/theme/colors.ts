/**
 * 1105: the colour the phone paints behind its status bar (meta theme-color: iOS 15+ Safari and Home Screen apps,
 * Android Chrome and installed apps). It has to be the page background, or the time and battery sit on a strip of
 * another colour. These ARE the --background tokens in app/globals.css (light 216 28% 97%, dark 240 6% 5%) as hex;
 * tests/round-1105-bars.test.ts converts the tokens and fails if the two ever drift. Hex because older Android
 * and iOS builds ignore hsl() in theme-color.
 */
export const THEME_COLOR = { light: "#f5f7fa", dark: "#0c0c0e" } as const;

/** One coordinated theme switch (1105): the whole page cross-fades on Outlly's curve. */
export const THEME_SWITCH_MS = 400;
