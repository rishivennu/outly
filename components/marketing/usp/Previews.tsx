import { Check, CornerDownLeft, Languages, MessageCircle, RefreshCw, Sparkles } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { Pip } from "@/components/brand/Pip";
import type { Platform } from "@/lib/domain";
import { platformName } from "@/lib/billing/plan-rules";
import { cn } from "@/lib/utils";

/*
 * Why Outlly (1161): six faithful previews of the product, drawn in markup so they stay sharp at every size and
 * weigh nothing. Each one shows the real screen it stands for (the caption editor, the publish deck, the calendar,
 * analytics, the inbox, Pip) with illustrative words and no invented numbers. Every loop is CSS, transform and
 * opacity only, and only runs while the grid is on screen (usp/Stage.tsx). Decorative throughout: the copy beside
 * each preview carries the meaning, so the previews are aria-hidden.
 */

const WORDS = ["Three", "small", "habits", "that", "grew", "my", "channel", "this", "year."];

/** The caption editor: a frame, the words lighting up in time, the language row and the three styles. `fill`: grow to the panel. */
export function CaptionPreview({ fill = false }: { fill?: boolean }) {
  return (
    <div className={cn("usp-shot usp-shot-ink", fill && "usp-shot-fill")} aria-hidden="true">
      <div className="usp-bar">
        <span className="usp-pill"><Languages className="h-3 w-3" /> Telugu</span>
        <span className="usp-pill usp-pill-lime">English</span>
        <span className="ml-auto usp-pill">00:12</span>
      </div>
      <div className="usp-frame">
        <span className="usp-frame-glow" />
        <p className="usp-cap">
          {WORDS.map((w, i) => (
            <span key={w} className="usp-word" style={{ ["--i" as string]: i }}>
              {w}
            </span>
          ))}
        </p>
      </div>
      <div className="usp-styles">
        {["Bold pop", "Boxed", "Clean"].map((s, i) => (
          <span key={s} className={cn("usp-style", i === 0 && "is-on")}>{s}</span>
        ))}
      </div>
      <div className="usp-track">
        {WORDS.map((w, i) => (
          <span key={w} className="usp-tick" style={{ ["--i" as string]: i, width: `${Math.max(6, w.length * 1.6)}%` }} />
        ))}
        <span className="usp-head" />
      </div>
    </div>
  );
}

/** The publish deck: one post, a row per connected platform, each with its own title and a status that lands. */
export function PublishPreview({ live }: { live: readonly Platform[] }) {
  const rows = live.slice(0, 3);
  return (
    <div className="usp-shot" aria-hidden="true">
      <div className="usp-post">
        <span className="usp-thumb" />
        <span className="usp-lines">
          <i style={{ width: "72%" }} />
          <i style={{ width: "48%" }} />
        </span>
      </div>
      <ul className="usp-dests">
        {rows.map((p, i) => (
          <li key={p} className="usp-dest" style={{ ["--i" as string]: i }}>
            <PlatformOrb platform={p} size={26} />
            <span className="usp-dest-copy">
              <b>{platformName(p)}</b>
              <i style={{ width: `${58 + i * 11}%` }} />
            </span>
            <span className="usp-status">
              <span className="usp-status-wait">Scheduled</span>
              <span className="usp-status-done"><Check className="h-3 w-3" /> Published</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
/** day -> status chip; a drafts, s scheduled, p published, f failed */
const MARKS: Record<number, { k: "a" | "s" | "p" | "f"; p: Platform }> = {
  2: { k: "p", p: "instagram" },
  5: { k: "p", p: "youtube" },
  9: { k: "p", p: "x" },
  12: { k: "f", p: "x" },
  16: { k: "s", p: "instagram" },
  18: { k: "s", p: "youtube" },
  23: { k: "a", p: "instagram" },
  26: { k: "s", p: "x" },
};
const LABEL = { a: "Draft", s: "Scheduled", p: "Published", f: "Retry" } as const;

/** The calendar: four weeks, posts on their days, one failed post with its retry. */
export function CalendarPreview() {
  return (
    <div className="usp-shot" aria-hidden="true">
      <div className="usp-bar">
        <span className="usp-pill usp-pill-lime">This month</span>
        <span className="ml-auto flex gap-1.5">
          <span className="usp-pill">Drafts</span>
          <span className="usp-pill">Scheduled</span>
        </span>
      </div>
      <div className="usp-cal">
        {DAYS.map((d) => {
          const m = MARKS[d];
          return (
            <span key={d} className={cn("usp-day", d === 15 && "is-today")}>
              <small>{d}</small>
              {m && (
                <span className={cn("usp-chip", `usp-chip-${m.k}`)} style={{ ["--i" as string]: d / 4 }}>
                  <PlatformOrb platform={m.p} size={10} />
                  {m.k === "f" ? <RefreshCw className="usp-spin h-2.5 w-2.5" /> : <i />}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <ul className="usp-key">
        {(["a", "s", "p", "f"] as const).map((k) => (
          <li key={k}><span className={cn("usp-chip usp-chip-static", `usp-chip-${k}`)}><i /></span>{LABEL[k]}</li>
        ))}
      </ul>
    </div>
  );
}

/** Analytics: platforms side by side, bars for the same metric, a labelled gap where a platform shares nothing. */
export function AnalyticsPreview({ live }: { live: readonly Platform[] }) {
  const rows = live.slice(0, 3);
  const heights = [0.82, 0.58, 0.44, 0.9, 0.66, 0.5, 0.72, 0.96, 0.6, 0.78, 0.86, 1];
  return (
    <div className="usp-shot" aria-hidden="true">
      <div className="usp-bar">
        <span className="usp-pill usp-pill-lime">Views</span>
        <span className="usp-pill">Engagement</span>
        <span className="ml-auto usp-pill">30 days</span>
      </div>
      <div className="usp-chart">
        {heights.map((h, i) => (
          <span key={i} className="usp-col" style={{ ["--h" as string]: h, ["--i" as string]: i }} />
        ))}
        <span className="usp-trend" />
      </div>
      <ul className="usp-legend">
        {rows.map((p, i) => (
          <li key={p} style={{ ["--i" as string]: i }}>
            <PlatformOrb platform={p} size={18} />
            <span>{platformName(p)}</span>
            {i === rows.length - 1 ? <em>Audience: not shared</em> : <i style={{ width: `${46 - i * 12}%` }} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

const THREADS: { p: Platform; kind: string; text: string; unread?: boolean }[] = [
  { p: "instagram", kind: "Comment on your Reel", text: "Which mic are you using here?", unread: true },
  { p: "youtube", kind: "Comment on your Short", text: "Part two please!", unread: true },
  { p: "x", kind: "Reply to your post", text: "Saved this. Thank you." },
];

/** The inbox: comments from each platform, unread first, and the reply box with Pip's suggestion ready. */
export function InboxPreview() {
  return (
    <div className="usp-shot" aria-hidden="true">
      <ul className="usp-threads">
        {THREADS.map((t, i) => (
          <li key={t.kind} className={cn("usp-thread", t.unread && "is-unread")} style={{ ["--i" as string]: i }}>
            <PlatformOrb platform={t.p} size={28} />
            <span className="usp-thread-copy">
              <small>{t.kind}</small>
              <span>{t.text}</span>
            </span>
            {t.unread && <span className="usp-dot" />}
          </li>
        ))}
      </ul>
      <div className="usp-reply">
        <span className="usp-suggest"><Sparkles className="h-3 w-3" /> Suggested reply</span>
        <span className="usp-reply-box">
          <MessageCircle className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="usp-typing">Thank you! It is the one on my gear list.</span>
          <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
        </span>
      </div>
    </div>
  );
}

/** Pip: a question about the numbers, Pip's answer from the same data, and the tools it reaches for. */
export function PipPreview() {
  return (
    <div className="usp-shot usp-shot-pip" aria-hidden="true">
      <div className="usp-chat">
        <span className="usp-msg usp-msg-you" style={{ ["--i" as string]: 0 }}>Which platform grew fastest this month?</span>
        <span className="usp-msg usp-msg-pip" style={{ ["--i" as string]: 1 }}>
          <Pip size={28} mood="happy" className="usp-pip shrink-0" />
          <span>Shorts led on views, Reels on comments. Want the per-post list?</span>
        </span>
        <span className="usp-tools" style={{ ["--i" as string]: 2 }}>
          <span className="usp-pill">Compare platforms</span>
          <span className="usp-pill">Best times to post</span>
          <span className="usp-pill">Trend</span>
        </span>
      </div>
    </div>
  );
}
