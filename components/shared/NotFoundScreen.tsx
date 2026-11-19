"use client";
import Link from "next/link";
import { ErrorScreen, ghostPill, pill } from "./ErrorScreen";

/**
 * R1224: the 404 screen as one client module of its own. Next sends the root not-found tree inside every page's
 * payload. As server JSX it carried the whole star field (150 spans) plus client references to Pip and CometShower,
 * and those references pointed at other routes' chunk groups, so every studio page also downloaded the landing page's
 * JS (gsap, ScrollTrigger, the marketing page chunk: about 170 kB) before it was interactive. One reference to this
 * module costs the not-found chunk alone; the screen itself is unchanged.
 */
export function NotFoundScreen() {
  return (
    <ErrorScreen
      code="Lost in orbit"
      mood="think"
      title="We couldn't find that page."
      body="The link may be old, or the page moved. Your posts and media are safe; nothing was changed."
      actions={
        <>
          <Link href="/home" className={`${pill} lime-bg lime-glow`}>Go to my dashboard</Link>
          <Link href="/" className={ghostPill}>Outlly home</Link>
        </>
      }
    />
  );
}
