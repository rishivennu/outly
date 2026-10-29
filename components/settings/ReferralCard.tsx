"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Gift, Share2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";

type Status =
  | "Invited"
  | "Registered"
  | "Awaiting qualifying payment"
  | "Payment verified"
  | "Reward granted"
  | "Reward expired"
  | "Referral disqualified";

type Summary = {
  code: string;
  url: string;
  enabled: boolean;
  terms: { plan: string; days: number; eligible: string[] };
  stats: { invited: number; registered: number; awaiting: number; verified: number; rewarded: number; disqualified: number };
  history: { id: string; friend: string; status: Status; at: string; rewardStarts: string | null; rewardEnds: string | null }[];
  mine: { status: Status; startsAt: string | null; endsAt: string | null } | null;
};

// Soft tones only: each status reads by its words first, colour is a hint.
const TONE: Record<Status, string> = {
  Invited: "bg-secondary text-muted-foreground",
  Registered: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  "Awaiting qualifying payment": "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  "Payment verified": "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100",
  "Reward granted": "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  "Reward expired": "bg-secondary text-muted-foreground",
  "Referral disqualified": "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** Refer & Earn: the friend who joins with this link gets a free month after their first payment. */
export function ReferralCard() {
  const toast = useToast();
  const [s, setS] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    api<Summary>("/api/referral").then(setS, () => setFailed(true));
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const copy = async () => {
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.", "error");
    }
  };
  const share = async () => {
    if (!s) return;
    try {
      await navigator.share({ title: "Join me on Outlly", text: `Plan and publish your content with Outlly. Sign up with my link and get a free month of ${s.terms.plan} after your first payment.`, url: s.url });
    } catch {
      /* closed the share sheet */
    }
  };

  const days = s?.terms.days ?? 30;
  const length = days % 30 === 0 ? `${days / 30} month${days === 30 ? "" : "s"}` : `${days} days`;
  const tiles: [string, number][] = s
    ? [
        ["Invited", s.stats.invited],
        ["Registered", s.stats.registered],
        ["Awaiting payment", s.stats.awaiting + s.stats.verified],
        ["Rewarded", s.stats.rewarded],
        ["Disqualified", s.stats.disqualified],
      ]
    : [];

  return (
    <section id="referral" className="glass flex h-full scroll-mt-24 flex-col rounded-[32px] p-6 sm:p-8" aria-labelledby="ref-h">
      <div className="flex items-start gap-3">
        <span className="lime-bg grid h-11 w-11 shrink-0 place-items-center rounded-2xl" aria-hidden="true">
          <Gift className="h-5 w-5" />
        </span>
        <div>
          <h2 id="ref-h" className="text-2xl font-semibold tracking-tight">Refer a friend, they get a free month</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {s
              ? `A friend who signs up with your link gets ${length} of ${s.terms.plan} free after their first payment on ${list(s.terms.eligible) || "a paid plan"}. It starts when their paid period ends, so nothing is lost.`
              : "A friend who signs up with your link gets a free month after their first payment."}
          </p>
        </div>
      </div>

      {failed ? (
        <p role="alert" className="mt-5 text-sm text-destructive">Your link didn't load. Refresh to try again.</p>
      ) : s && !s.enabled ? (
        <p className="mt-5 rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">Refer &amp; Earn is paused right now. Friends you already invited keep any reward they earned.</p>
      ) : (
        <>
          {s?.mine && (
            <p className="mt-5 flex items-start gap-2 rounded-2xl bg-secondary/60 p-4 text-sm" role="status">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime-ink" aria-hidden="true" />
              <span>
                You joined with a friend's link.{" "}
                {s.mine.status === "Reward granted" && s.mine.endsAt
                  ? `Your free ${s.terms.plan} time runs ${day(s.mine.startsAt)} to ${day(s.mine.endsAt)}.`
                  : s.mine.status === "Reward expired"
                    ? "Your free month has been used."
                    : s.mine.status === "Referral disqualified"
                      ? "This invite did not qualify for a reward."
                      : `Make your first payment on ${list(s.terms.eligible)} and your free month is added after it.`}
              </span>
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <label htmlFor="ref-url" className="sr-only">Your invite link</label>
            <input
              id="ref-url"
              readOnly
              value={s?.url ?? "Loading…"}
              onFocus={(e) => e.currentTarget.select()}
              className="h-12 min-w-0 flex-1 basis-64 rounded-2xl bg-secondary/60 px-4 text-sm text-foreground hairline focus-visible:outline-2"
            />
            <Button variant="lime" onClick={copy} disabled={!s} aria-live="polite" className="h-12">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} {copied ? "Copied" : "Copy link"}
            </Button>
            {canShare && (
              <Button variant="outline" onClick={share} disabled={!s} className="h-12">
                <Share2 className="h-4 w-4" aria-hidden="true" /> Share
              </Button>
            )}
          </div>

          {s && (
            <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {tiles.map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-secondary/60 px-4 py-3">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {s && (
            <div className="mt-5">
              <h3 className="text-sm font-medium">Your invites</h3>
              {s.history.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Nobody has used your link yet. Share it with a creator friend.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl hairline">
                  {s.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{h.friend}</p>
                        <p className="text-xs text-muted-foreground">
                          {day(h.at)}
                          {h.status === "Reward granted" && h.rewardEnds ? `, free until ${day(h.rewardEnds)}` : ""}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${TONE[h.status]}`}>{h.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ul className="mt-5 space-y-1 text-xs text-muted-foreground">
            <li>One reward per person and per inbox. Referring yourself does not count.</li>
            <li>The reward is added only after a verified payment, never for a sign up alone.</li>
            <li>If that payment is refunded or charged back, the free month is removed.</li>
          </ul>
        </>
      )}
    </section>
  );
}
