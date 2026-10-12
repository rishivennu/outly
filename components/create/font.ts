import { Outfit } from "next/font/google";

/**
 * The one place that uses a different typeface: the New creation steps (journey rail, mobile
 * step bar, step headline). Loaded here, not in the root layout, so every other page keeps
 * Bricolage / DM Sans and never downloads this font.
 */
export const createFont = Outfit({ subsets: ["latin"], variable: "--font-create", display: "swap" });
