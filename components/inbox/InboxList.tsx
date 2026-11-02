"use client";
import { forwardRef, useEffect, type ReactNode } from "react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * 1093: the pieces both inbox tabs share. A mail-client layout: a dense list on the left, the open item on the right,
 * full screen on a phone. Nothing here talks to the server.
 */

export type InboxTab = "comments" | "messages";

/** What every pane gets from the page shell: the tab switch, the search text and the header's Refresh. */
export type PaneProps = {
  tabs: ReactNode;
  query: string;
  refreshTick: number;
  onBusy: (busy: boolean) => void;
  onWaiting: (n: number) => void;
};

/** On a phone the open item covers the page; the page underneath must not scroll behind it. */
export function useMobileLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    const mq = window.matchMedia("(min-width: 1024px)");
    // Rotating a tablet past the breakpoint turns the overlay into a side pane, so the page scrolls again.
    const apply = () => {
      el.style.overflow = mq.matches ? prev : "hidden";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      el.style.overflow = prev;
    };
  }, [on]);
}


/** Short relative time for a list row: "now", "4m", "3h", "2d", then a date. */
export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Typing in a field must never trigger list shortcuts. */
export function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** The lg breakpoint, where list and detail sit side by side. */
export const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

function hue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function initials(name: string) {
  const parts = name.replace(/^@/, "").trim().split(/[\s._-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

/** Tinted initials (ink on its own 16% tint, so contrast holds for every hue), or the real picture when there is one. */
export function PersonAvatar({ name, src, platform, size = 40, onBroken }: { name: string; src?: string | null; platform?: Platform; size?: number; onBroken?: () => void }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} onError={onBroken} referrerPolicy="no-referrer" className="rounded-full object-cover" style={{ width: size, height: size }} />
      ) : (
        <span aria-hidden="true" className="ib-av grid place-items-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: Math.round(size * 0.34), ["--h" as string]: hue(name) }}>
          {initials(name)}
        </span>
      )}
      {platform && <PlatformOrb platform={platform} size={Math.max(14, Math.round(size * 0.42))} ring className="absolute -bottom-0.5 -right-1" />}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mr-1 inline-grid min-w-[18px] place-items-center rounded-[5px] border border-border px-1 font-sans text-[10.5px] font-semibold leading-[16px] text-foreground/80">{children}</kbd>;
}

/** Comments / Messages. Real tabs: arrow keys move between them, the panel below is labelled by the selected one. */
export function InboxTabs({ tab, onPick, counts }: { tab: InboxTab; onPick: (t: InboxTab) => void; counts: Record<InboxTab, number> }) {
  return (
    <div role="tablist" aria-label="Inbox" className="grid grid-cols-2 rounded-xl bg-secondary p-[3px]">
      {(["comments", "messages"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          id={`inbox-tab-${t}`}
          aria-selected={tab === t}
          aria-controls={tab === t ? `inbox-panel-${t}` : undefined}
          tabIndex={tab === t ? 0 : -1}
          onClick={() => onPick(t)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const next = t === "comments" ? "messages" : "comments";
              onPick(next);
              document.getElementById(`inbox-tab-${next}`)?.focus();
            }
          }}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-[9px] text-[13.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            tab === t ? "bg-card text-foreground shadow-sm dark:bg-foreground/10" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t === "comments" ? "Comments" : "Messages"}
          {counts[t] > 0 && (
            <span className={cn("rounded-full px-1.5 text-[11px] font-bold leading-[17px]", tab === t ? "bg-lime text-lime-foreground" : "bg-foreground/10 text-foreground/80")}>
              {counts[t]}
              <span className="sr-only"> waiting</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** "Needs reply" / "All" plus one icon per platform. The hit area is 44px even where the pill looks smaller. */
export function ScopeBar({
  needsOnly,
  onNeedsOnly,
  platforms,
  platform,
  onPlatform,
}: {
  needsOnly: boolean;
  onNeedsOnly: (v: boolean) => void;
  platforms: readonly Platform[];
  platform: Platform | "all";
  onPlatform: (p: Platform | "all") => void;
}) {
  const pill = "relative inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <div className="mt-2.5 flex items-center gap-1.5">
      <button type="button" aria-pressed={needsOnly} onClick={() => onNeedsOnly(true)} className={cn(pill, needsOnly ? "bg-foreground text-background" : "text-muted-foreground hairline hover:text-foreground")}>
        Needs reply
      </button>
      <button type="button" aria-pressed={!needsOnly} onClick={() => onNeedsOnly(false)} className={cn(pill, !needsOnly ? "bg-foreground text-background" : "text-muted-foreground hairline hover:text-foreground")}>
        All
      </button>
      <span className="flex-1" />
      {platforms.map((p) => {
        const on = platform === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            aria-label={on ? `Showing ${PLATFORM_META[p].name} only. Show every platform` : `Show ${PLATFORM_META[p].name} only`}
            title={PLATFORM_META[p].name}
            onClick={() => onPlatform(on ? "all" : p)}
            className="group grid h-11 w-11 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className={cn("grid h-8 w-8 place-items-center rounded-full transition", on ? "bg-secondary ring-2 ring-foreground/70" : "hairline group-hover:bg-secondary", platform !== "all" && !on && "opacity-50")}>
              <PlatformOrb platform={p} size={18} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type RowProps = {
  id: string;
  selected: boolean;
  needsReply: boolean;
  name: string;
  avatar: ReactNode;
  time: string;
  preview: string;
  context: ReactNode;
  tag?: ReactNode;
  label: string;
  onOpen: () => void;
};

/** One dense row. Waiting rows carry a lime dot AND bold text AND a spoken "needs a reply", never colour alone. */
export const InboxRow = forwardRef<HTMLButtonElement, RowProps>(function InboxRow({ id, selected, needsReply, name, avatar, time, preview, context, tag, label, onOpen }, ref) {
  return (
    <li>
      <button
        ref={ref}
        id={id}
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        className={cn(
          "relative flex w-full items-start gap-3 border-b border-border/70 px-4 py-3 text-left transition-colors focus-visible:z-[1] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          selected ? "bg-secondary/80 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-lime" : "hover:bg-secondary/50",
        )}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("truncate text-[14px]", needsReply ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>{name}</span>
            {tag}
            <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{time}</span>
            {needsReply && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-lime" />}
          </span>
          <span className={cn("mt-0.5 block truncate text-[13.5px]", needsReply ? "text-foreground" : "text-muted-foreground")}>{preview}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">{context}</span>
        </span>
      </button>
    </li>
  );
});

export function Tag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "question" | "practice" }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold", tone === "question" ? "ib-tag-q" : "bg-secondary text-muted-foreground")}>{children}</span>
  );
}

/** One amber line for every connection problem, instead of a stack of red cards before any content. */
export function ConnectionStrip({ title, body, actions, details }: { title: ReactNode; body?: ReactNode; actions?: ReactNode; details?: ReactNode }) {
  return (
    <div role="status" className="rounded-2xl bg-warning/10 px-4 py-2.5 text-[13px] ring-1 ring-inset ring-warning/25">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warning" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{title}</span>
          {body && <span className="hidden text-foreground/80 sm:inline"> {body}</span>}
        </p>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {details}
    </div>
  );
}

export const stripButton = "inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-card px-3 text-[13px] font-medium text-foreground hairline transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring relative before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']";

export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
