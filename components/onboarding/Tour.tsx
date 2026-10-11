"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useUser } from "@/components/shell/UserContext";

/*
 * Guided tour: a spotlight that walks the real navigation, one stop at a time.
 * Targets are plain `data-tour` attributes, so the sidebar (desktop) and the bottom bar (mobile)
 * both work; the first visible match wins, and a missing target falls back to a centred card.
 */

type Stop = { target?: string; title: string; body: string };

const STOPS: Stop[] = [
  { title: "Welcome to Outly", body: "A quick look around: about a minute. Use the arrow keys or the buttons, and press Esc to leave any time." },
  { target: "new-post", title: "Start with one video", body: "Drop a video here. Outly drafts a caption, a title and a post for each platform, and you edit anything before it goes out." },
  { target: "content", title: "Everything you've made", body: "Every video and post in one place, with where each one went and how it's doing." },
  { target: "calendar", title: "Plan the week", body: "Schedule posts and see what's going out when. Drag to move a post to another day." },
  { target: "analytics", title: "Live numbers, per platform", body: "Each connected account gets its own dashboard: followers, views, reach, your best posts, and suggestions worked out from those numbers." },
  { target: "inbox", title: "Every comment, one list", body: "Comments from all your accounts land here, and you can reply without opening each app." },
  { target: "approvals", title: "Get a yes before it posts", body: "Send a review link to a teammate or client. They approve or ask for changes; nothing goes out until it's cleared." },
  { target: "accounts", title: "Connect your accounts", body: "Instagram and YouTube connect here. You sign in on their own pages, so Outly never sees your password." },
  { title: "You're set", body: "Connect an account to see your live numbers, or start your first post. You can replay this tour from Settings or the Home checklist." },
];

const EVENT = "outly:tour";
export const tourKey = (userId: string) => `outly:tour-done:${userId}`;
export function startTour() {
  window.dispatchEvent(new Event(EVENT));
}

function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

export function Tour() {
  const user = useUser();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  const close = useCallback(
    (done = true) => {
      if (done) localStorage.setItem(tourKey(user.id), new Date().toISOString());
      setStep(null);
      window.dispatchEvent(new Event("outly:tour-closed"));
      (opener.current as HTMLElement | null)?.focus?.();
    },
    [user.id],
  );

  useEffect(() => {
    const open = () => {
      opener.current = document.activeElement;
      setStep(0);
    };
    window.addEventListener(EVENT, open);
    if (new URLSearchParams(location.search).get("tour") === "1") open();
    return () => window.removeEventListener(EVENT, open);
  }, []);

  // Follow the target through scrolls and resizes, one measurement per frame at most.
  useLayoutEffect(() => {
    if (step === null) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = findTarget(STOPS[step].target);
        setRect(el ? el.getBoundingClientRect() : null);
        setSize({ w: window.innerWidth, h: window.innerHeight });
      });
    };
    findTarget(STOPS[step].target)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  useEffect(() => {
    if (step !== null) next.current?.focus({ preventScroll: true });
  }, [step]);

  if (step === null || typeof document === "undefined") return null;
  const stop = STOPS[step];
  const last = step === STOPS.length - 1;
  const go = (d: number) => setStep((s) => (s === null ? s : Math.min(STOPS.length - 1, Math.max(0, s + d))));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowRight") return last ? close() : go(1);
    if (e.key === "ArrowLeft") return go(-1);
    if (e.key === "Tab" && card.current) {
      // keep focus inside the card while the tour is open
      const f = Array.from(card.current.querySelectorAll<HTMLElement>("button, a[href]"));
      if (!f.length) return;
      const [first, end] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), end.focus());
      else if (!e.shiftKey && document.activeElement === end) (e.preventDefault(), first.focus());
    }
  };

  const PAD = 6;
  const W = Math.min(340, size.w - 24);
  let pos: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const right = rect.right + 16 + W < size.w;
    if (right) pos = { left: rect.right + 16, top: Math.max(12, Math.min(rect.top - 8, size.h - 260)) };
    else {
      const above = rect.top > size.h / 2;
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - W / 2, size.w - W - 12));
      pos = above ? { left, bottom: size.h - rect.top + 14 } : { left, top: rect.bottom + 14 };
    }
  }

  return createPortal(
    <div className="tour-root fixed inset-0 z-[95]" onKeyDown={onKey}>
      {rect ? (
        <div
          className="tour-spot pointer-events-none fixed rounded-2xl"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          aria-hidden="true"
        />
      ) : (
        <div className="tour-dim fixed inset-0" aria-hidden="true" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        key={step}
        className="tour-card glass-strong fixed rounded-[24px] p-5 shadow-2xl hairline"
        style={{ width: W, ...pos }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground tabular">
            {step + 1} of {STOPS.length}
          </span>
          <span className="flex flex-1 gap-1" aria-hidden="true">
            {STOPS.map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-lime" : "bg-foreground/10"}`} />
            ))}
          </span>
          <button type="button" onClick={() => close()} aria-label="Close the tour" className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-lg font-semibold tracking-tight">
          {stop.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {stop.body}
        </p>
        <div className="mt-5 flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => go(-1)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
          )}
          {step === 0 && (
            <button type="button" onClick={() => close()} className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
              Skip
            </button>
          )}
          <span className="flex-1" />
          {last ? (
            <>
              <Link href="/accounts" onClick={() => close()} className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium hover:bg-secondary">
                Connect
              </Link>
              <Link href="/create" ref={next as unknown as React.Ref<HTMLAnchorElement>} onClick={() => close()} className="lime-bg inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-5 text-sm font-semibold">
                New post <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          ) : (
            <button ref={next} type="button" onClick={() => go(1)} className="lime-bg inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-5 text-sm font-semibold">
              {step === 0 ? "Show me" : "Next"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
