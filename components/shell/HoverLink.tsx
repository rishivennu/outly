"use client";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, type ComponentProps } from "react";
import { useLivePlatforms } from "./LivePlatforms";
import { warmAnalytics, warmPage, warmReview } from "@/lib/client/warm";
import { PRELOAD_TABS } from "@/lib/client/preload";

/**
 * A nav link that warms its route on intent (hover, focus, touch) instead of on sight. The sidebar shows a
 * dozen links, and Next.js prefetching all of them at once fired a dozen server renders on every page load,
 * each fighting the page itself for the connection. Intent-only keeps clicks fast without that stampede.
 */
export const HoverLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function HoverLink({ href, onMouseEnter, onFocus, onTouchStart, ...rest }, ref) {
  const router = useRouter();
  const live = useLivePlatforms();
  const warm = () => {
    // A link that opens a new tab (the Outlly website) never uses this tab's router: warming it only downloads the site's code.
    if (typeof href !== "string" || !href.startsWith("/") || rest.target === "_blank") return;
    // Analytics (1039): the whole page and the numbers it loads after, so it opens filled in.
    if (href === "/analytics") return warmAnalytics(router, live);
    if (href === "/profile-review") return warmReview(router);
    // A platform's dashboard renders its numbers on the server: fetch the full page, not just its loader.
    if (href.startsWith("/analytics/")) return warmPage(router, href);
    // 1114: the primary tabs the background preload keeps (usually already held, so this costs nothing).
    if ((PRELOAD_TABS as readonly string[]).includes(href)) return warmPage(router, href);
    router.prefetch(href);
  };
  return (
    <NextLink
      ref={ref}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => (warm(), onMouseEnter?.(e))}
      onFocus={(e) => (warm(), onFocus?.(e))}
      onTouchStart={(e) => (warm(), onTouchStart?.(e))}
      {...rest}
    />
  );
});
