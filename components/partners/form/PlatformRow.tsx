"use client";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PARTNER_PLATFORMS, PARTNER_PLATFORM_LABEL, type PartnerPlatform } from "@/lib/partners/types";
import { CONTROL, Field, describe } from "./Field";
import { detectPlatform, fieldId, withUrl, type PlatformDraft } from "./draft";

const PLACEHOLDER: Partial<Record<PartnerPlatform, string>> = {
  instagram: "instagram.com/yourname",
  youtube: "youtube.com/@yourchannel",
  tiktok: "tiktok.com/@yourname",
  x: "x.com/yourname",
};

export function PlatformRow({
  i,
  row,
  errors,
  onChange,
  onRemove,
  onBlur,
}: {
  i: number;
  row: PlatformDraft;
  errors: Record<string, string>;
  onChange: (row: PlatformDraft) => void;
  onRemove: () => void;
  onBlur: (key: string) => void;
}) {
  const k = (f: string) => `socials.${i}.${f}`;
  const id = (f: string) => fieldId(k(f));
  const err = (f: string) => errors[k(f)];
  const blur = (f: string) => () => onBlur(k(f));
  const label = PARTNER_PLATFORM_LABEL[row.platform as PartnerPlatform];
  const detected = !row.locked && !!row.platform && detectPlatform(row.url) === row.platform;
  const name = label ?? `Platform ${i + 1}`;

  return (
    <fieldset className="rounded-2xl bg-secondary/30 p-4 sm:p-5">
      <legend className="sr-only">{name}</legend>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
        <Field
          id={id("url")}
          label={label && row.platform !== "other" ? `${label} profile or channel link` : "Profile or channel link"}
          hint={detected ? `Detected ${label} from your link. Change it below if that's wrong.` : undefined}
          error={err("url") || err("handle")}
          className="sm:col-span-2"
        >
          <Input
            {...describe(id("url"), err("url") || err("handle"), detected)}
            onBlur={blur("url")}
            className="rounded-xl"
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={300}
            placeholder={PLACEHOLDER[row.platform as PartnerPlatform] ?? "https://"}
            value={row.url}
            onChange={(e) => onChange(withUrl(row, e.target.value))}
          />
        </Field>
        <Field id={id("platform")} label="Platform" error={err("platform")}>
          <select
            {...describe(id("platform"), err("platform"))}
            onBlur={blur("platform")}
            value={row.platform}
            onChange={(e) => onChange({ ...row, platform: e.target.value, locked: true })}
            className={CONTROL}
          >
            <option value="">Choose a platform</option>
            {PARTNER_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PARTNER_PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("followers")} label="Approximate followers" error={err("followers")}>
          <Input
            {...describe(id("followers"), err("followers"))}
            onBlur={blur("followers")}
            className="rounded-xl tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            placeholder="12,500"
            maxLength={16}
            value={row.followers}
            onChange={(e) => onChange({ ...row, followers: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="ghost" className="h-11 px-3" onClick={onRemove} aria-label={`Remove ${name}`}>
          <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
          Remove
        </Button>
      </div>
    </fieldset>
  );
}
