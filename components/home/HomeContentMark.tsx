"use client";
import { useEffect } from "react";

/** The User Timing mark the perf collector reads as "first dashboard content". */
export const HOME_CONTENT_MARK = "outly:home-content";
const once = `try{performance.getEntriesByName("${HOME_CONTENT_MARK}").length||performance.mark("${HOME_CONTENT_MARK}")}catch(e){}`;

/**
 * Perf: placed right after Home's first real card. In the first HTML the inline script runs as the browser parses
 * that card, which is when it can first paint it; after a soft navigation the effect marks it instead. Once per load.
 */
export function HomeContentMark({ nonce }: { nonce?: string }) {
  useEffect(() => {
    try {
      if (!performance.getEntriesByName(HOME_CONTENT_MARK).length) performance.mark(HOME_CONTENT_MARK);
    } catch {
      /* no User Timing: nothing to mark */
    }
  }, []);
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: once }} />;
}
