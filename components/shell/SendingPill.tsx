"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon } from "@/components/brand/brands";
import { PLATFORM_META, isPlatform } from "@/lib/domain";
import { fetchSending, liveLabel, notifyOnce, onSendingWake, sendSummary, type LivePost } from "@/lib/client/sending";
import { cn } from "@/lib/utils";

/**
 * The sending pill (10-16g): a small Live Activity that follows you around the studio while a post sends.
 * "2 of 3 live", the platforms with a status dot each, a tap back to the posting screen.
 * Hidden on the posting screen of the same post, which already says all of this in full.
 *
 * 1139: it also wakes on a push arriving on this device (the service worker messages every open page), when
 * the tab comes back and on focus, and checks again every IDLE_MS while the tab is visible. That is how a post
 * started on the laptop appears on the phone without a reload. Nothing is polled while the tab is hidden.
 */
type Row = LivePost;
const FAST = 4000;
const SLOW = 10_000;
const IDLE_MS = 45_000;
const SHOW_DONE_MS = 9000;

export function SendingPill() {
  const pathname = usePathname();
  const [rows, setRows] = useState<Row[]>([]);
  const [here, setHere] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const seen = useRef<Record<string, string>>({}); // post id -> last summary text, to spot a settle
  const doneAt = useRef<Record<string, number>>({});
  const started = useRef(Date.now());

  // Which post is on screen right now (the posting screen reads ?post=).
  useEffect(() => {
    const read = () => setHere(new URLSearchParams(window.location.search).get("post"));
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, [pathname]);

  const check = useCallback(async () => {
    if (document.hidden) return;
    try {
      const posts = await fetchSending();
      const now = Date.now();
      for (const p of posts) {
        const s = sendSummary(p.targets);
        const was = seen.current[p.id];
        // Settled while we were watching: tell the browser too, if they opted in.
        if (was !== undefined && !s.active && was !== s.text) {
          doneAt.current[p.id] = now;
          const onIt = new URLSearchParams(window.location.search).get("post") === p.id;
          if (document.hidden || !onIt) notifyOnce(p.id, s.tone === "live" ? "You're live" : "Needs a hand", `"${p.title}": ${s.text}.`, `/create?post=${p.id}`);
        }
        if (!s.active && doneAt.current[p.id] === undefined) doneAt.current[p.id] = was === undefined ? now - SHOW_DONE_MS / 2 : now;
        seen.current[p.id] = s.text;
      }
      setRows(posts);
      const anyActive = posts.some((p) => sendSummary(p.targets).active);
      const anyFresh = posts.some((p) => now - (doneAt.current[p.id] ?? 0) < SHOW_DONE_MS);
      setPolling(anyActive || anyFresh);
    } catch {
      /* signed out or offline: try again on the next wake */
    }
  }, []);

  useEffect(() => {
    void check();
    return onSendingWake(() => {
      setPolling(true);
      void check();
    });
  }, [check]);

  // While something is moving, every few seconds. Otherwise a quiet heartbeat, so a send started on another
  // device shows up here even if this one has notifications off.
  useEffect(() => {
    const every = polling ? (Date.now() - started.current > 120_000 ? SLOW : FAST) : IDLE_MS;
    const id = setInterval(check, every);
    return () => clearInterval(id);
  }, [polling, check]);

  const now = Date.now();
  const show = rows.filter((p) => p.id !== here && (sendSummary(p.targets).active || now - (doneAt.current[p.id] ?? 0) < SHOW_DONE_MS));
  const p = show[0];
  if (!p) return null;
  const s = sendSummary(p.targets);
  const more = show.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-40 flex justify-center px-3 lg:pl-[17rem]">
      <Link
        href={`/create?post=${p.id}`}
        className={cn("sp-pill pointer-events-auto inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-full py-1.5 pl-3 pr-4 text-[13px] font-semibold text-white", `sp-${s.tone}`)}
        aria-label={`${p.title}: ${p.targets.map((t) => `${isPlatform(t.platform) ? PLATFORM_META[t.platform].name : t.platform} ${liveLabel(t, p.status)}`).join(", ")}. Open the posting screen.`}
      >
        <span className={cn("sp-dot", s.active && "sp-dot-live")} aria-hidden="true" />
        <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
          {p.targets.map((t) =>
            isPlatform(t.platform) ? (
              <span key={t.id} className="relative">
                <AppIcon brand={t.platform} size={20} />
                <span className={cn("sp-st", t.status === "published" ? "live" : t.status === "failed" ? "bad" : "work")} />
              </span>
            ) : null,
          )}
        </span>
        <span className="min-w-0 truncate" aria-live="polite">
          {s.text}
          {more > 0 && <span className="sp-more"> +{more} more</span>}
        </span>
      </Link>
    </div>
  );
}
