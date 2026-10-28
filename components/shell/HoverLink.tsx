"use client";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, type ComponentProps } from "react";
import { useLivePlatforms } from "./LivePlatforms";
import { warmAnalytics, warmPage } from "@/lib/client/warm";

/**
 * A nav link that warms its route on intent (hover, focus, touch) instead of on sight. The sidebar shows a
 * dozen links, and Next.js prefetching all of them at once fired a dozen server renders on every page load,
 * each fighting the page itself for the connection. Intent-only keeps clicks fast without that stampede.
 */
export const HoverLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function HoverLink({ href, onMouseEnter, onFocus, onTouchStart, ...rest }, ref) {
  const router = useRouter();
  const live = useLivePlatforms();
  const warm = () => {
    if (typeof href !== "string" || !href.startsWith("/")) return;
    // Analytics (1039): the whole page and the numbers it loads after, so it opens filled in.
    if (href === "/analytics") return warmAnalytics(router, live);
    // A platform's dashboard renders its numbers on the server: fetch the full page, not just its loader.
    if (href.startsWith("/analytics/")) return warmPage(router, href);
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
