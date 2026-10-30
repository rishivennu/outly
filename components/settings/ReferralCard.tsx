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
  earned: { count: number; startsAt: string | null; until: string | null };
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
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : xs.length === 2 ? `${xs[0]} or ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, or ${xs[xs.length - 1]}`);

/** Refer & Earn (1066): when a friend who joined with this link makes a first payment, the SHARER gets a free month. */
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
    if (!s) return false;
    try {
      await navigator.clipboard.writeText(s.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      return true;
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.", "error");
      return false;
    }
  };
  // The main button: the phone's share sheet where there is one, otherwise the link goes on the clipboard.
  const invite = async () => {
    if (!s) return;
    if (canShare) {
      try {
        await navigator.share({ title: "Join me on Outlly", text: "I plan and publish my content with Outlly. Join me with my link:", url: s.url });
        return;
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return; // closed the share sheet
      }
    }
    if (await copy()) toast("Link copied. Send it to a friend.", "ok");
  };

  const days = s?.terms.days ?? 30;
  const length = days === 30 ? "one month" : days % 30 === 0 ? `${days / 30} months` : `${days} days`;
  const cta = days % 30 === 0 ? `${days / 30} Month${days === 30 ? "" : "s"}` : `${days} Days`;
  const unit = days === 30 ? "month" : "reward";
  const earned = s?.earned;
  const freeNow = earned?.until && new Date(earned.until) > new Date() ? earned.until : null;
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
          <h2 id="ref-h" className="text-2xl font-semibold tracking-tight">Refer a friend, get a free month</h2>
          <p className="mt-1 text-[15px] font-medium">Love Outlly? Share it with a friend and get rewarded!</p>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            When your friend signs up using your referral link and makes their first payment for {s ? list(s.terms.eligible) || "a paid plan" : "a paid plan"},{" "}
            <strong className="font-semibold text-foreground">you&rsquo;ll get {length} of {s?.terms.plan ?? "Creator"} free.</strong> Your reward starts after their qualifying payment is confirmed.
          </p>
        </div>
      </div>

      {failed ? (
        <p role="alert" className="mt-5 text-sm text-destructive">Your link didn't load. Refresh to try again.</p>
      ) : s && !s.enabled ? (
        <p className="mt-5 rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">Refer &amp; Earn is paused right now. Friends you already invited keep any reward they earned.</p>
      ) : (
        <>
          {earned && earned.count > 0 && (
            <p className="mt-5 flex items-start gap-2 rounded-2xl bg-secondary/60 p-4 text-sm" role="status">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime-ink" aria-hidden="true" />
              <span>
                You&rsquo;ve earned {earned.count} free {unit}
                {earned.count === 1 ? "" : "s"} so far. Thank you for sharing!{" "}
                {freeNow ? `Your free ${s!.terms.plan} time runs ${earned.startsAt ? `${day(earned.startsAt)} to ` : "until "}${day(freeNow)}.` : ""}
              </span>
            </p>
          )}

          <label htmlFor="ref-url" className="mt-5 block text-sm font-medium">Your invite link</label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="ref-url"
              readOnly
              value={s?.url ?? "Loading…"}
              onFocus={(e) => e.currentTarget.select()}
              className="h-12 min-w-0 flex-1 basis-64 rounded-2xl bg-secondary/60 px-4 text-sm text-foreground hairline focus-visible:outline-2"
            />
            <Button variant="outline" onClick={copy} disabled={!s} aria-live="polite" className="h-12">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <Button variant="lime" onClick={invite} disabled={!s} className="mt-3 h-12 w-full sm:w-auto">
            <Share2 className="h-4 w-4" aria-hidden="true" /> Invite a Friend &amp; Earn {cta} Free
          </Button>
          <p className="mt-2 text-sm italic text-muted-foreground">Share your link, invite a friend, and unlock your free {unit} when they become a paying customer.</p>

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
            <li>One reward per friend and per inbox. Referring yourself does not count.</li>
            <li>The reward is added only after your friend&rsquo;s payment is verified, never for a sign up alone.</li>
            <li>Each friend who pays earns you another {unit}. On a paid plan, your free time starts when your current paid period ends, so you never lose a day.</li>
            <li>If your friend&rsquo;s payment is refunded or charged back, that free {unit} is removed.</li>
          </ul>
        </>
      )}
    </section>
  );
}
