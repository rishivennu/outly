import { Poppins } from "next/font/google";

/**
 * Pip's own typeface (1125): Poppins, only inside the Pip panel (.pc). Every other page keeps the site font set
 * in Admin > Site fonts. Not preloaded: the closed launcher shows no text, so the font is only fetched once
 * the panel opens and draws words.
 *   800 welcome headline · 700 panel title, key points, numbers · 600 section headings
 *   500 labels and muted lines · 400 answer text
 * Latin, Latin Extended (Spanish, Portuguese...) and Devanagari (Hindi); other scripts fall back to the site font.
 */
export const pipFont = Poppins({ subsets: ["latin", "latin-ext", "devanagari"], weight: ["400", "500", "600", "700", "800"], variable: "--font-pip", display: "swap", preload: false });
