"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PARTNER_PLATFORM_LABEL, type PartnerPlatform } from "@/lib/partners/types";
import { CATEGORIES, SHORT_PREFERENCES, STEPS, toNumber, type Draft } from "./draft";

const num = (s: string) => {
  const n = toNumber(s);
  return n === undefined || Number.isNaN(n) ? s || "Not given" : n.toLocaleString("en-US");
};

function Group({ step, onEdit, children }: { step: number; onEdit: (i: number) => void; children: ReactNode }) {
  return (
    <section aria-labelledby={`pa-review-${step}`} className="rounded-2xl bg-secondary/30 p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 id={`pa-review-${step}`} className="text-[15px] font-semibold tracking-tight">
          {STEPS[step]}
        </h4>
        <Button type="button" variant="ghost" size="sm" className="h-11 px-3" onClick={() => onEdit(step)} aria-label={`Edit ${STEPS[step].toLowerCase()}`}>
          Edit
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-2.5 text-[14px] sm:grid-cols-2">{children}</dl>
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
  const pref = SHORT_PREFERENCES.find((x) => x.value === q.preference);
  return (
    <div className="grid gap-3">
      <Group step={0} onEdit={onEdit}>
        <Item label="Name" value={p.fullName.trim() || "Not given"} />
        <Item label="Email" value={p.email.trim() || "Not given"} />
        <Item label="Country" value={p.country.trim() || "Not given"} />
      </Group>
      <Group step={1} onEdit={onEdit}>
        {d.socials.map((r, i) => (
          <Item
            key={i}
            wide
            label={PARTNER_PLATFORM_LABEL[r.platform as PartnerPlatform] ?? "Platform"}
            value={
              <>
                <span className="tabular-nums">{num(r.followers)}</span> followers
                <span className="block break-all text-muted-foreground">{r.url}</span>
              </>
            }
          />
        ))}
      </Group>
      <Group step={2} onEdit={onEdit}>
        <Item label="Average views" value={<span className="tabular-nums">{num(s.avgViews)}</span>} />
        <Item label="Content category" value={CATEGORIES.find((c) => c.value === s.niche)?.label ?? "Not given"} />
        <Item label="Engagement rate" value={s.engagementRate.trim() ? <span className="tabular-nums">{`${s.engagementRate.replace(/%$/, "")}%`}</span> : "Not given"} />
        <Item label="Attachments" value={d.files.length ? d.files.map((f) => f.name).join(", ") : "None"} />
      </Group>
      <Group step={3} onEdit={onEdit}>
        <Item label="Partnership" value={pref?.title ?? "Not given"} />
        {q.extra.trim() && <Item label="Anything else" wide value={q.extra.trim()} />}
      </Group>
    </div>
  );
}
