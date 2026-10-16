"use client";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, type ComponentProps } from "react";

/**
 * A nav link that warms its route on intent (hover, focus, touch) instead of on sight. The sidebar shows a
 * dozen links, and Next.js prefetching all of them at once fired a dozen server renders on every page load,
 * each fighting the page itself for the connection. Intent-only keeps clicks fast without that stampede.
 */
export const HoverLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function HoverLink({ href, onMouseEnter, onFocus, onTouchStart, ...rest }, ref) {
  const router = useRouter();
  const warm = () => {
    if (typeof href === "string" && href.startsWith("/")) router.prefetch(href);
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
