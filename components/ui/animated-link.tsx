"use client";

import Link from "next/link";
import React from "react";

import { cn } from "@/lib/utils";

/**
 * AnimatedLink: hover/focus underline that draws in and retracts.
 * Adapted from Skiper UI "Skiper 40 Animated Link" (https://skiper-ui.com, author @gurvinder-singh02).
 * Attribution to Skiper UI is required for the free version.
 *
 * Changes from the original: one component with variants instead of Link000-005, the line sits on an inner
 * span so it hugs the text inside tall (44px) hit areas, keyboard focus shows the same line, and reduced
 * motion turns the transition off. Variants 004/005 (white mix-blend fill) were left out: they break light mode.
 */
type Variant = "grow" | "center" | "arrow";

const LINE =
  "relative before:pointer-events-none before:absolute before:inset-x-0 before:-bottom-[0.12em] before:h-[0.07em] before:rounded-full before:bg-current before:content-[''] " +
  "before:scale-x-0 before:transition-transform before:duration-300 before:ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:before:transition-none " +
  "group-hover/al:before:scale-x-100 group-focus-visible/al:before:scale-x-100";

const ORIGIN: Record<Variant, string> = {
  // Draws in from the left, leaves to the right (Skiper Link000/001).
  grow: "before:origin-right group-hover/al:before:origin-left group-focus-visible/al:before:origin-left",
  arrow: "before:origin-right group-hover/al:before:origin-left group-focus-visible/al:before:origin-left",
  // Grows out from the middle (Skiper Link003).
  center: "before:origin-center",
};

function Arrow() {
  return (
    <svg
      className="ml-[0.3em] size-[0.55em] shrink-0 translate-y-1 opacity-0 transition-all duration-300 group-hover/al:translate-y-0 group-hover/al:opacity-100 group-focus-visible/al:translate-y-0 group-focus-visible/al:opacity-100 motion-reduce:transition-none"
      fill="none"
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path d="M1.004 9.166 9.337.833m0 0v8.333m0-8.333H1.004" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Props = {
  href: string;
  children: React.ReactNode;
  className?: string;
  variant?: Variant;
  external?: boolean;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;

export function AnimatedLink({ href, children, className, variant = "grow", external, ...rest }: Props) {
  const isExternal = external ?? /^(https?:|mailto:|tel:)/.test(href);
  const inner = (
    <>
      <span className={cn(LINE, ORIGIN[variant])}>{children}</span>
      {variant === "arrow" && <Arrow />}
    </>
  );
  const cls = cn("group/al inline-flex items-center", className);
  if (isExternal) {
    const newTab = /^https?:/.test(href);
    return (
      <a href={href} className={cls} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {inner}
    </Link>
  );
}

/** Same underline for non-link children (e.g. a button styled as a link). Wrap the label text. */
export function AnimatedUnderline({ children, variant = "grow" }: { children: React.ReactNode; variant?: Variant }) {
  return <span className={cn(LINE, ORIGIN[variant])}>{children}</span>;
}
