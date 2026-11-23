import { Silkscreen } from "next/font/google";

/** Bitmap display face for the "pixel" word in the Creator Hub mixed-type headlines (R1310). Loaded only where it renders. */
export const pixelFont = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false });
