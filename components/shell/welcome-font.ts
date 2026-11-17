import { Pixelify_Sans } from "next/font/google";

/**
 * R1180: the welcome headline's pixel face (after the reference's bitmap "[Hello World]" lettering). Loaded here,
 * not in the root layout, and never preloaded: the browser only fetches it when the welcome actually shows.
 */
export const welcomeFont = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixel", display: "swap", preload: false });
