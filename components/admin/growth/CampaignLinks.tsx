"use client";
import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { CHANNELS, campaignUrl } from "@/lib/growth/core";

/** Builds a tagged link per channel. Anyone who signs up within 30 days of clicking it is credited to it. */
export function CampaignLinks({ base }: { base: string }) {
  const [channel, setChannel] = useState<string>(CHANNELS[0].id);
  const [campaign, setCampaign] = useState("launch");
  const [path, setPath] = useState("/");
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const ids = { ch: useId(), camp: useId(), path: useId(), out: useId() };
  const c = CHANNELS.find((x) => x.id === channel)!;
  const url = campaignUrl(base, c.id, c.medium, campaign, path);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Link copied.", "ok");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Couldn't copy. Select the link and copy it by hand.", "error");
    }
  }

  const field = "h-11 w-full rounded-2xl bg-background px-3.5 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={ids.ch} className="mb-1.5 block text-[13px] font-semibold">Channel</label>
          <select id={ids.ch} value={channel} onChange={(e) => setChannel(e.target.value)} className={field}>
            {CHANNELS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={ids.camp} className="mb-1.5 block text-[13px] font-semibold">Campaign name</label>
          <input id={ids.camp} value={campaign} maxLength={40} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. diwali-offer" className={field} />
        </div>
        <div>
          <label htmlFor={ids.path} className="mb-1.5 block text-[13px] font-semibold">Lands on</label>
          <select id={ids.path} value={path} onChange={(e) => setPath(e.target.value)} className={field}>
            <option value="/">Home page</option>
            <option value="/signup">Signup</option>
            <option value="/waitlist">Waitlist</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <output id={ids.out} aria-label="Campaign link" className="flex min-h-11 flex-1 items-center break-all rounded-2xl bg-secondary/60 px-3.5 py-2 font-mono text-[12.5px] hairline">{url}</output>
        <button type="button" onClick={copy} aria-describedby={ids.out} className="lime-bg inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">The first tagged link a visitor clicks wins, for 30 days. Waitlist joins from it are tagged too.</p>
    </div>
  );
}
