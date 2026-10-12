"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { adminApi } from "@/lib/client/admin-api";
import { CORE_PLATFORMS, PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";
import { PLATFORM_SETUP } from "@/lib/social/platform-setup";
import { Card, Pill } from "./ui";
import { CopyRow, SecretField, type Secret, type SecretEdit } from "./IntegrationsForm";

type Keys = Record<Platform, { clientId: string; clientSecret: Secret }>;

/** One card per platform: app ID, secret, the callback URL to paste into the platform's console, and whether it is live. */
export function PlatformKeysForm({ keys: initial, live: initialLive, base }: { keys: Keys; live: Platform[]; base: string }) {
  const [keys, setKeys] = useState(initial);
  const [live, setLive] = useState(initialLive);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {PLATFORMS.map((p) => (
        <PlatformCard key={p} p={p} saved={keys[p]} live={live.includes(p)} base={base} onSaved={(k, l) => { setKeys(k); setLive(l); }} />
      ))}
    </div>
  );
}

function PlatformCard({ p, saved, live, base, onSaved }: { p: Platform; saved: Keys[Platform]; live: boolean; base: string; onSaved: (k: Keys, l: Platform[]) => void }) {
  const toast = useToast();
  const meta = PLATFORM_META[p];
  const s = PLATFORM_SETUP[p];
  const [id, setId] = useState(saved.clientId);
  const [secret, setSecret] = useState<SecretEdit>(undefined);
  const [busy, setBusy] = useState(false);
  const core = CORE_PLATFORMS.includes(p as never);
  const dirty = id.trim() !== saved.clientId || (secret !== undefined && secret !== "");
  const willBeLive = !!id.trim() && (secret === null ? false : saved.clientSecret.set || !!secret);

  async function save() {
    setBusy(true);
    try {
      const r = await adminApi<{ platforms: Keys; live: Platform[] }>("/api/admin/platforms", {
        method: "PUT",
        json: { platform: p, clientId: id.trim(), clientSecret: secret === undefined || secret === "" ? undefined : secret },
      });
      onSaved(r.platforms, r.live);
      setSecret(undefined);
      const on = r.live.includes(p);
      toast(on ? `${meta.name} is live. Creators can connect it now.` : core ? `Saved. ${meta.name} stays in the studio but can't connect until both keys are set.` : `Saved. ${meta.name} stays hidden until both keys are set.`, on ? undefined : "info");
    } catch (e: any) {
      toast(e.message ?? "Couldn't save.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <PlatformOrb platform={p} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold">
            {meta.name}
            {live ? <Pill tone="ok">Live</Pill> : <Pill tone="muted">Not live</Pill>}
            {core && <Pill tone="info">Always shown</Pill>}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{s.note}</p>
        </div>
      </div>

      <div className="mt-5 grid min-w-0 gap-4 [&>*]:min-w-0">
        <div>
          <Label htmlFor={`${p}-id`}>{s.idLabel}</Label>
          <Input id={`${p}-id`} value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono text-[14px]" placeholder={`${meta.name} ${s.idLabel.toLowerCase()}`} />
        </div>
        <SecretField id={`${p}-secret`} label={s.secretLabel} saved={saved.clientSecret} value={secret} onChange={setSecret} placeholder={`Paste the ${s.secretLabel.toLowerCase()}`} />
        <CopyRow label="Callback" value={`${base}/api/accounts/${p}/callback`} />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Scopes: <code className="break-all text-[12px]">{s.scopes}</code>
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || busy} variant="lime">
          {busy ? "Saving…" : dirty && willBeLive && !live ? `Save and go live` : "Save"}
        </Button>
        <a href={s.console} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Open {s.consoleName} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </Card>
  );
}
