"use client";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HANDLE_RULES } from "@/lib/partners/core";
import { PARTNER_FORMATS, PARTNER_FORMAT_LABEL, PARTNER_NICHES, PARTNER_NICHE_LABEL, PARTNER_PLATFORMS, PARTNER_PLATFORM_LABEL, type PartnerPlatform } from "@/lib/partners/types";
import { CONTROL, Field, describe } from "./Field";
import { fieldId, withHandle, withPlatform, type SocialDraft } from "./draft";

export function SocialRow({
  i,
  row,
  primary,
  canRemove,
  errors,
  onChange,
  onPrimary,
  onRemove,
  onBlur,
}: {
  i: number;
  row: SocialDraft;
  primary: boolean;
  canRemove: boolean;
  errors: Record<string, string>;
  onChange: (row: SocialDraft) => void;
  onPrimary: () => void;
  onRemove: () => void;
  onBlur: (key: string) => void;
}) {
  const k = (f: string) => `socials.${i}.${f}`;
  const id = (f: string) => fieldId(k(f));
  const err = (f: string) => errors[k(f)];
  const blur = (f: string) => () => onBlur(k(f));
  const platform = (row.platform || "instagram") as PartnerPlatform;
  const label = PARTNER_PLATFORM_LABEL[platform];

  return (
    <fieldset className="rounded-2xl bg-secondary/30 p-4 sm:p-5">
      <legend className="sr-only">Account {i + 1}</legend>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-semibold tracking-tight" aria-hidden="true">
          Account {i + 1}
        </p>
        <div className="flex items-center gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-[14px] text-foreground">
            <input
              type="radio"
              name="pa-primary"
              {...describe(id("primary"), err("primary"))}
              checked={primary}
              onChange={onPrimary}
              className="h-5 w-5 accent-[hsl(var(--lime-ink))]"
            />
            Primary account
          </label>
          {canRemove && (
            <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove account ${i + 1}`}>
              <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("platform")} label="Platform" error={err("platform")}>
          <select {...describe(id("platform"), err("platform"))} value={row.platform} onChange={(e) => onChange(withPlatform(row, e.target.value))} onBlur={blur("platform")} className={CONTROL}>
            {PARTNER_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PARTNER_PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("handle")} label="Username" hint={HANDLE_RULES[platform].hint} error={err("handle")}>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-muted-foreground">
              @
            </span>
            <Input
              {...describe(id("handle"), err("handle"), true)}
              className="rounded-xl ps-8"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={120}
              value={row.handle}
              onChange={(e) => onChange(withHandle(row, e.target.value))}
              onBlur={blur("handle")}
            />
          </div>
        </Field>
        <Field id={id("url")} label="Profile link" hint={platform === "other" ? "A full https link to your profile." : `Filled in from your username. Paste your ${label} link if it is different.`} error={err("url")} className="sm:col-span-2">
          <Input
            {...describe(id("url"), err("url"), true)}
            className="rounded-xl"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            maxLength={300}
            value={row.url}
            placeholder={platform === "other" ? "https://" : undefined}
            onChange={(e) => onChange({ ...row, url: e.target.value, urlEdited: e.target.value.trim() !== "" })}
            onBlur={blur("url")}
          />
        </Field>
        <Field id={id("followers")} label="Followers" error={err("followers")}>
          <Input
            {...describe(id("followers"), err("followers"))}
            className={cn("rounded-xl tabular-nums")}
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            value={row.followers}
            onChange={(e) => onChange({ ...row, followers: e.target.value })}
            onBlur={blur("followers")}
          />
        </Field>
        <Field id={id("niche")} label="Niche" error={err("niche")}>
          <select {...describe(id("niche"), err("niche"))} value={row.niche} onChange={(e) => onChange({ ...row, niche: e.target.value })} onBlur={blur("niche")} className={CONTROL}>
            <option value="">Choose a niche</option>
            {PARTNER_NICHES.map((n) => (
              <option key={n} value={n}>
                {PARTNER_NICHE_LABEL[n]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("format")} label="Main content format" error={err("format")} className="sm:col-span-2">
          <select {...describe(id("format"), err("format"))} value={row.format} onChange={(e) => onChange({ ...row, format: e.target.value })} onBlur={blur("format")} className={CONTROL}>
            <option value="">Choose a format</option>
            {PARTNER_FORMATS.map((f) => (
              <option key={f} value={f}>
                {PARTNER_FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </fieldset>
  );
}
