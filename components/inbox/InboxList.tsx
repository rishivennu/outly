"use client";
import { forwardRef, useEffect, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
  /** 1114: this tick is the page bringing itself up to date (not the Refresh button): skip it after a fresh load. */
  refreshQuiet?: boolean;
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
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={onBroken} referrerPolicy="no-referrer" className="rounded-full object-cover" style={{ width: size, height: size }} />
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
  return <kbd className="mr-1 inline-grid min-w-[18px] place-items-center rounded-[5px] border border-border px-1 font-sans text-xs font-semibold leading-[16px] text-foreground/80">{children}</kbd>;
}

/** Comments / Messages. Real tabs: arrow keys move between them, the panel below is labelled by the selected one. */
export function InboxTabs({ tab, onPick, counts }: { tab: InboxTab; onPick: (t: InboxTab) => void; counts: Record<InboxTab, number> }) {
  return (
    <div role="tablist" aria-label="Inbox" className="gseg grid grid-cols-2 rounded-xl bg-secondary p-[3px]">
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
            "inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] text-[14px] touch:h-11 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            tab === t ? "bg-card text-foreground shadow-sm dark:bg-foreground/10" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t === "comments" ? "Comments" : "Messages"}
          {counts[t] > 0 && (
            <span className={cn("rounded-full px-1.5 text-xs font-bold leading-[17px]", tab === t ? "bg-lime text-lime-foreground" : "bg-foreground/10 text-foreground/80")}>
              {counts[t]}
              <span className="sr-only"> waiting</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Phase 2: one entry in the filter row ("Needs reply", "Unread", "All", "Archived"). The count is spoken, never colour only. */
export type ScopeView = { id: string; label: string; count?: number };

const seg =
  "relative inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.96]";

/**
 * The one filter row both tabs share: which items (a segmented control) and, under it, which platform.
 * `views` + `chips` is the Phase 2 form; `needsOnly` (Needs reply / All with a platform menu) stays for callers that use it.
 * The hit area is 44px even where the pill looks smaller.
 */
export function ScopeBar({
  needsOnly,
  onNeedsOnly,
  views,
  view,
  onView,
  platforms,
  platform,
  onPlatform,
  chips = false,
}: {
  needsOnly?: boolean;
  onNeedsOnly?: (v: boolean) => void;
  views?: readonly ScopeView[];
  view?: string;
  onView?: (id: string) => void;
  platforms: readonly Platform[];
  platform: Platform | "all";
  onPlatform: (p: Platform | "all") => void;
  chips?: boolean;
}) {
  const list: readonly ScopeView[] = views ?? [
    { id: "needs", label: "Needs reply" },
    { id: "all", label: "All" },
  ];
  const current = views ? view : needsOnly ? "needs" : "all";
  const pick = (id: string) => (views ? onView?.(id) : onNeedsOnly?.(id === "needs"));
  const segmented = (
    <div role="group" aria-label="Which to show" className={cn("gseg rounded-full bg-secondary p-0.5", views ? "grid min-w-0 grid-flow-col auto-cols-fr" : "flex shrink-0")}>
      {list.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={current === v.id}
          aria-label={v.count ? `${v.label}, ${v.count}` : undefined}
          onClick={() => pick(v.id)}
          className={cn(seg, "min-w-0", !views && "px-3.5", current === v.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}
        >
          <span className="truncate">{v.label}</span>
          {!!v.count && (
            <span aria-hidden="true" className={cn("ml-1 hidden rounded-full px-1.5 text-xs font-bold tabular-nums leading-[17px] min-[400px]:inline", current === v.id ? "bg-lime text-lime-foreground" : "bg-foreground/10 text-foreground/80")}>
              {v.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
  if (chips) {
    return (
      <div className="mt-2.5 flex flex-col gap-2">
        {segmented}
        {platforms.length > 1 && <PlatformChips platforms={platforms} platform={platform} onPlatform={onPlatform} />}
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex items-center gap-2">
      {segmented}
      <span className="flex-1" />
      {platforms.length > 1 && (
        <label className="relative flex min-w-0 items-center">
          <span className="sr-only">Platform</span>
          {platform !== "all" && <PlatformOrb platform={platform} size={16} className="pointer-events-none absolute left-2.5" />}
          <select
            value={platform}
            onChange={(e) => onPlatform(e.target.value as Platform | "all")}
            className={cn(
              "h-11 min-w-0 max-w-[11rem] cursor-pointer appearance-none truncate rounded-full bg-card pr-8 text-[13px] font-medium text-foreground hairline transition [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              platform === "all" ? "pl-3.5" : "pl-8",
            )}
          >
            <option value="all">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_META[p].name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </label>
      )}
    </div>
  );
}

/** Phase 2: "All" plus one chip per platform. Below 400px a chip is the platform's mark only, still named for a screen reader. */
export function PlatformChips({ platforms, platform, onPlatform }: { platforms: readonly Platform[]; platform: Platform | "all"; onPlatform: (p: Platform | "all") => void }) {
  const chip = (on: boolean) =>
    cn(
      "gchip relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.96]",
      on ? "bg-foreground text-background" : "bg-card text-foreground hairline [@media(hover:hover)]:hover:bg-secondary",
    );
  return (
    <div role="group" aria-label="Platform" className="flex flex-wrap items-center gap-1.5">
      <button type="button" aria-pressed={platform === "all"} onClick={() => onPlatform("all")} className={chip(platform === "all")}>
        All platforms
      </button>
      {platforms.map((p) => (
        <button key={p} type="button" aria-pressed={platform === p} aria-label={PLATFORM_META[p].name} title={PLATFORM_META[p].name} onClick={() => onPlatform(p)} className={chip(platform === p)}>
          <PlatformOrb platform={p} size={16} />
          <span aria-hidden="true" className="hidden min-[400px]:inline">
            {PLATFORM_META[p].name}
          </span>
        </button>
      ))}
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
  /** Phase 2: when given, the dot and the bold text mean "unread" instead of "needs a reply". */
  unread?: boolean;
};

/** One dense row. Waiting rows carry a lime dot AND bold text AND a spoken "needs a reply", never colour alone. */
export const InboxRow = forwardRef<HTMLButtonElement, RowProps>(function InboxRow({ id, selected, needsReply, name, avatar, time, preview, context, tag, label, onOpen, unread }, ref) {
  const strong = unread ?? needsReply;
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
            <span className={cn("truncate text-[14px]", strong ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>{name}</span>
            {tag}
            <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">{time}</span>
            {strong && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-lime" />}
          </span>
          <span className={cn("mt-0.5 block truncate text-[14px]", strong ? "text-foreground" : "text-muted-foreground")}>{preview}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">{context}</span>
        </span>
      </button>
    </li>
  );
});

export function Tag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "question" | "practice" }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-px text-xs font-semibold", tone === "question" ? "ib-tag-q" : "bg-secondary text-muted-foreground")}>{children}</span>
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

export const stripButton = "inline-flex min-h-[36px] touch:min-h-11 items-center gap-1.5 rounded-xl bg-card px-3 text-[13px] font-medium text-foreground hairline transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring relative before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']";

export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
