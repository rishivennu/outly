"use client";
import Link from "next/link";
import { ArrowRight, BarChart3, CalendarClock, Layers, MessageCircle, Scale, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Product" mega menu (10-16, after navbar.gallery's SaaS / AI patterns): icon tiles with a one-line
 * description and one featured card, so a first-time visitor sees what Outlly does before scrolling.
 * Each tile is a section anchor on the landing page; "Ask Pip" opens the help chat in place.
 */
export interface ProductItem {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  /** section anchor; null = opens Pip */
  sec: string | null;
}

export const PRODUCT_ITEMS: ProductItem[] = [
  { id: "features", title: "AI captions and hooks", desc: "One video, copy written for each platform", icon: Sparkles, sec: "features" },
  { id: "how", title: "Schedule and publish", desc: "Post now or pick the best time, everywhere at once", icon: CalendarClock, sec: "how" },
  { id: "why", title: "Track every destination", desc: "See what each platform did with the same video", icon: BarChart3, sec: "why" },
  { id: "platforms", title: "Platforms", desc: "Reels, Shorts and X today, more on the way", icon: Layers, sec: "platforms" },
  { id: "compare", title: "Compare", desc: "How Outlly stacks up against the usual tools", icon: Scale, sec: "compare" },
  { id: "pip", title: "Ask Pip", desc: "Our help assistant answers right here", icon: MessageCircle, sec: null },
];

export const openPip = () => window.dispatchEvent(new CustomEvent("outly:chat-open"));

function Tile({ item, onPick, compact }: { item: ProductItem; onPick: (sec: string | null) => void; compact?: boolean }) {
  const Icon = item.icon;
  const body = (
    <>
      <span className="np-ico" aria-hidden="true">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold leading-tight text-foreground">{item.title}</span>
        {!compact && <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{item.desc}</span>}
      </span>
    </>
  );
  const cls = cn("np-tile", compact && "np-tile-compact");
  if (!item.sec)
    return (
      <button type="button" className={cls} onClick={() => { onPick(null); openPip(); }}>
        {body}
      </button>
    );
  return (
    <Link href={`/#${item.sec}`} className={cls} onClick={() => onPick(item.sec)}>
      {body}
    </Link>
  );
}

export function ProductPanel({ items, onPick, showDemo }: { items: ProductItem[]; onPick: (sec: string | null) => void; showDemo: boolean }) {
  return (
    <div className="grid gap-2 p-2 md:grid-cols-[1fr_236px]">
      <ul className="grid grid-cols-2 gap-1">
        {items.map((it) => (
          <li key={it.id}>
            <Tile item={it} onPick={onPick} />
          </li>
        ))}
      </ul>
      {showDemo && (
        <Link href="/#demo" className="np-feature group" onClick={() => onPick("demo")}>
          <span className="np-sky" aria-hidden="true">
            <span /><span /><span />
          </span>
          <span className="relative mt-auto block">
            <span className="block font-display text-[19px] font-semibold leading-tight tracking-tight">See it in 60 seconds</span>
            <span className="mt-1 block text-[13px] leading-snug opacity-80">One upload becomes a Reel, a Short and a post.</span>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold">
              Watch the demo
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}

/** Mobile: the same items as compact two-column tiles inside the drop-down card. */
export function ProductTilesCompact({ items, onPick }: { items: ProductItem[]; onPick: (sec: string | null) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-1">
      {items.map((it) => (
        <li key={it.id}>
          <Tile item={it} onPick={onPick} compact />
        </li>
      ))}
    </ul>
  );
}
