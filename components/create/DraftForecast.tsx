"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/client/api";
import type { Draft } from "@/lib/client/checks";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { LEVEL_LABEL } from "@/lib/intelligence/profile-core";
import type { Prediction } from "@/lib/intelligence/model/scorer-core";

/**
 * R1327 (plan Phase 3, "Create Step panel"): what the creator's own history says this draft will do, per destination,
 * on the Launch step. One POST /api/intelligence/predictions per enabled platform, debounced on the words and the
 * timing; the server's `explanation` is shown as it is (it names the source and the sample), and a platform with
 * nothing to go on shows the server's `reason`, never a number. With a post id the forecast is stored and judged a
 * week after publishing (Your baselines > accuracy).
 */
type Media = { duration?: number | null; width?: number | null; height?: number | null } | null;
type Answer = { prediction: Prediction | null; reason: string | null };
type Row = { platform: Platform; state: "loading" } | { platform: Platform; state: "ok"; answer: Answer } | { platform: Platform; state: "error" };

const DEBOUNCE_MS = 900;
const num = (n: number) => Math.round(n).toLocaleString("en");

export function forecastKey(platforms: readonly Platform[], drafts: Record<Platform, Draft>, hook: string, media: Media, when: string | null, postId: string | null) {
  return JSON.stringify([platforms, platforms.map((p) => [drafts[p].title, drafts[p].caption, drafts[p].hashtags]), hook, media?.duration ?? null, media?.width ?? null, media?.height ?? null, when, postId]);
}

export function DraftForecast(p: { platforms: Platform[]; drafts: Record<Platform, Draft>; hook: string; media: Media; when: Date | null; postId: string | null; online: boolean; className?: string }) {
  const whenIso = p.when ? p.when.toISOString() : null;
  const key = forecastKey(p.platforms, p.drafts, p.hook, p.media, whenIso, p.postId);
  const [rows, setRows] = useState<Row[]>([]);
  const last = useRef<string>("");

  useEffect(() => {
    if (!p.online || !p.platforms.length) return;
    if (key === last.current) return;
    const t = setTimeout(() => {
      last.current = key;
      setRows(p.platforms.map((platform) => ({ platform, state: "loading" })));
      let gone = false;
      Promise.all(
        p.platforms.map(async (platform): Promise<Row> => {
          const d = p.drafts[platform];
          try {
            const answer = await api<Answer>("/api/intelligence/predictions", {
              method: "POST",
              json: { platform, format: "video", title: d.title || null, caption: d.caption || null, hashtags: d.hashtags || null, hook: p.hook || null, durationSec: p.media?.duration ?? null, width: p.media?.width ?? null, height: p.media?.height ?? null, scheduledAt: whenIso, postId: p.postId },
            });
            return { platform, state: "ok", answer };
          } catch {
            return { platform, state: "error" };
          }
        }),
      ).then((out) => !gone && setRows(out));
      return () => {
        gone = true;
      };
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // The key folds every input this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p.online]);

  if (!p.platforms.length || !rows.length) return null;
  return (
    <section aria-labelledby="draft-forecast-h" className={p.className}>
      <h2 id="draft-forecast-h" className="eyebrow flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> What to expect</h2>
      <ul className="mt-2 space-y-2" aria-live="polite">
        {rows.map((r) => (
          <li key={r.platform} className="rounded-2xl bg-secondary/50 px-4 py-3 text-[13px] leading-relaxed">
            <span className="font-medium text-foreground">{PLATFORM_META[r.platform].name}</span>
            {r.state === "loading" && <span className="text-muted-foreground"> · reading your past posts…</span>}
            {r.state === "error" && <span className="text-muted-foreground"> · couldn't read your baselines right now; nothing is held up.</span>}
            {r.state === "ok" && r.answer.prediction && (
              <>
                <span className="text-foreground"> · ~{num(r.answer.prediction.predicted)} views</span>
                <span className="text-muted-foreground tabular-nums"> (usually {num(r.answer.prediction.low)} to {num(r.answer.prediction.high)})</span>
                <span className="block text-muted-foreground">{r.answer.prediction.explanation} <span className="text-foreground/70">{LEVEL_LABEL[r.answer.prediction.level]}.</span></span>
              </>
            )}
            {r.state === "ok" && !r.answer.prediction && <span className="block text-muted-foreground">{r.answer.reason ?? "Nothing to go on yet."}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">An estimate from your own measured posts, never a promise. It is judged against the real numbers a week after publishing.</p>
    </section>
  );
}
