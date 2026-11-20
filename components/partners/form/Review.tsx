"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  PARTNER_FORMAT_LABEL,
  PARTNER_NICHE_LABEL,
  PARTNER_PLATFORM_LABEL,
  PARTNER_PREFERENCE_LABEL,
  POSTING_FREQUENCY_LABEL,
  type PartnerFormat,
  type PartnerNiche,
  type PartnerPlatform,
  type PartnerPreference,
  type PostingFrequency,
} from "@/lib/partners/types";
import { STEPS, toNumber, type Draft } from "./draft";
import { fmtHandle } from "@/lib/handle";

const num = (s: string) => {
  const n = toNumber(s);
  return n === undefined || Number.isNaN(n) ? s || "Not given" : n.toLocaleString("en-US");
};
const or = (s: string) => s.trim() || "Not given";

function Group({ step, onEdit, children }: { step: number; onEdit: (i: number) => void; children: ReactNode }) {
  return (
    <section aria-labelledby={`pa-review-${step}`} className="rounded-2xl bg-secondary/30 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 id={`pa-review-${step}`} className="text-[15px] font-semibold tracking-tight">
          {STEPS[step]}
        </h4>
        <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => onEdit(step)} aria-label={`Edit ${STEPS[step].toLowerCase()}`}>
          Edit
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Item({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">{value}</dd>
    </div>
  );
}

export function Review({ d, onEdit }: { d: Draft; onEdit: (i: number) => void }) {
  const { personal: p, stats: s, proposal: q } = d;
  return (
    <div className="grid gap-3">
      <Group step={0} onEdit={onEdit}>
        <Item label="Full name" value={or(p.fullName)} />
        <Item label="Email" value={or(p.email)} />
        <Item label="Country" value={or(p.country)} />
        <Item label="City" value={or(p.city)} />
        <Item label="Phone" value={or(p.phone)} />
        <Item label="Creator or business name" value={or(p.brandName)} />
      </Group>
      <Group step={1} onEdit={onEdit}>
        {d.socials.map((r, i) => (
          <Item
            key={i}
            wide
            label={`${PARTNER_PLATFORM_LABEL[r.platform as PartnerPlatform] ?? r.platform}${i === d.primary ? ", primary" : ""}`}
            value={
              <>
                {fmtHandle(r.handle)}, {num(r.followers)} followers
                <span className="block text-muted-foreground">
                  {PARTNER_NICHE_LABEL[r.niche as PartnerNiche] ?? "No niche"}, {PARTNER_FORMAT_LABEL[r.format as PartnerFormat] ?? "No format"}
                </span>
                <span className="block break-all text-muted-foreground">{r.url}</span>
              </>
            }
          />
        ))}
      </Group>
      <Group step={2} onEdit={onEdit}>
        <Item label="Average views" value={num(s.avgViews)} />
        <Item label="Average reach" value={num(s.reach)} />
        <Item label="Likes, comments, shares" value={`${num(s.avgLikes)}, ${num(s.avgComments)}, ${num(s.avgShares)}`} />
        <Item label="Engagement rate" value={s.engagementRate.trim() ? `${s.engagementRate.replace(/%$/, "")}%` : "Not given"} />
        <Item label="Top audience countries" value={or(s.audienceCountries)} />
        <Item label="Audience age" value={or(s.ageRange)} />
        <Item label="Posting frequency" value={POSTING_FREQUENCY_LABEL[s.frequency as PostingFrequency] ?? "Not given"} />
        <Item label="Content niche" value={PARTNER_NICHE_LABEL[s.niche as PartnerNiche] ?? "Not given"} />
        <Item label="Attachments" wide value={d.files.length ? d.files.map((f) => f.name).join(", ") : "None"} />
      </Group>
      <Group step={3} onEdit={onEdit}>
        <Item label="Why Outlly" wide value={or(q.why)} />
        <Item label="How you would introduce Outlly" wide value={or(q.how)} />
        <Item label="Content type" value={or(q.contentType)} />
        <Item label="Posts" value={num(q.posts)} />
        <Item label="Preference" value={PARTNER_PREFERENCE_LABEL[q.preference as PartnerPreference] ?? "Not given"} />
        <Item label="Expected compensation" value={or(q.compensation)} />
        <Item label="Past brand collaborations" wide value={or(q.pastCollabs)} />
        <Item label="Portfolio" wide value={q.portfolio.filter((u) => u.trim()).join("\n") || "None"} />
      </Group>
    </div>
  );
}
