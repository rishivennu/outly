"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";

type Summary = { code: string; url: string; joined: number; rewarded: number };

/** Share link: a friend who signs up through it and pays gives you a free month. */
export function ReferralCard() {
  const toast = useToast();
  const [s, setS] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api<Summary>("/api/referral").then(setS, () => setFailed(true));
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
  return (
    <section id="referral" className="glass flex h-full scroll-mt-24 flex-col rounded-[32px] p-6 sm:p-8" aria-labelledby="ref-h">
      <div className="flex items-start gap-3">
        <span className="lime-bg grid h-11 w-11 shrink-0 place-items-center rounded-2xl" aria-hidden="true">
          <Gift className="h-5 w-5" />
        </span>
        <div>
          <h2 id="ref-h" className="text-2xl font-semibold tracking-tight">Invite a friend, get a month free</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">When someone joins with your link and buys a plan, your next month is on us. No limit.</p>
        </div>
      </div>
      {failed ? (
        <p role="alert" className="mt-auto pt-5 text-sm text-destructive">Your link didn't load. Refresh to try again.</p>
      ) : (
        <>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
            <label htmlFor="ref-url" className="sr-only">Your invite link</label>
            <input id="ref-url" readOnly value={s?.url ?? "Loading…"} onFocus={(e) => e.currentTarget.select()} className="h-12 min-w-0 flex-1 rounded-2xl bg-secondary/60 px-4 text-sm text-foreground hairline focus-visible:outline-2" />
            <Button variant="lime" onClick={copy} disabled={!s} aria-live="polite">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          {s && (
            <p className="mt-3 text-sm text-muted-foreground tabular">
              {s.joined === 0 ? "Nobody has joined with your link yet." : `${s.joined} joined · ${s.rewarded} upgraded · ${s.rewarded} free month${s.rewarded === 1 ? "" : "s"} earned`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
