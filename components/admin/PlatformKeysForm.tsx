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
import { platformHint, platformStatus, savedToast, saveLabel } from "@/lib/admin/platform-status";
import { Card, Pill, StatusBadge, Tooltip } from "./ui";
import { Switch } from "./Switch";
import { CopyRow, SecretField, type Secret, type SecretEdit } from "./IntegrationsForm";

type Keys = Record<Platform, { clientId: string; clientSecret: Secret; dms?: boolean; insights?: boolean }>;

/** The messaging permissions, dropped from the Scopes line when DMs are switched off (1031f). */
const DM_SCOPES = ["instagram_business_manage_messages", "pages_messaging", "pages_manage_metadata"];

/** One card per platform: app ID, secret, the callback URL to paste into the platform's console, and whether it is live. */
/** Meta direct-message setup (1031): pasted into the Meta dashboard's Webhooks and App settings. */
export type DmSetup = { webhook: string; verifyToken: string; deletion: string };

export function PlatformKeysForm({ keys: initial, ready: initialReady, base, dm }: { keys: Keys; ready: Platform[]; base: string; dm?: DmSetup }) {
  const [keys, setKeys] = useState(initial);
  const [ready, setReady] = useState(initialReady);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {PLATFORMS.map((p) => (
        <PlatformCard
          key={p}
          p={p}
          saved={keys[p]}
          ready={ready.includes(p)}
          base={base}
          dm={p === "instagram" || p === "facebook" ? dm : undefined}
          deletion={p === "threads" ? dm?.deletion : undefined}
          clash={p === "instagram" && !!keys.instagram?.clientId && keys.instagram.clientId === keys.facebook?.clientId}
          onSaved={(k, r) => { setKeys(k); setReady(r); }}
        />
      ))}
    </div>
  );
}

function PlatformCard({ p, saved, ready, base, dm, deletion, clash, onSaved }: { p: Platform; saved: Keys[Platform]; ready: boolean; base: string; dm?: DmSetup; deletion?: string; clash?: boolean; onSaved: (k: Keys, r: Platform[]) => void }) {
  const toast = useToast();
  const meta = PLATFORM_META[p];
  const s = PLATFORM_SETUP[p];
  const [id, setId] = useState(saved.clientId);
  const [secret, setSecret] = useState<SecretEdit>(undefined);
  const [busy, setBusy] = useState(false);
  const [dms, setDms] = useState(saved.dms !== false);
  // R1199: off unless switched on. Off still asks a signed-in super admin, so the review screencast can be recorded.
  const [insights, setInsights] = useState(saved.insights === true);
  const ig = p === "instagram";
  const insightsChanged = ig && insights !== (saved.insights === true);
  const core = CORE_PLATFORMS.includes(p as never);
  const dmsChanged = !!dm && dms !== (saved.dms !== false);
  const dirty = id.trim() !== saved.clientId || (secret !== undefined && secret !== "") || dmsChanged || insightsChanged;
  const baseScopes = dm && !dms ? s.scopes.split(",").map((x) => x.trim()).filter((x) => !DM_SCOPES.includes(x)).join(", ") : s.scopes;
  const scopes = ig && insights ? `${baseScopes}, instagram_business_manage_insights` : baseScopes;
  const status = platformStatus({ core, ready, idSet: !!saved.clientId, secretSet: saved.clientSecret.set });
  const idNext = !!id.trim();
  const secretNext = secret === null ? false : saved.clientSecret.set || !!secret;
  // Env keys can fill in for the saved ones, so the prediction only promises "live" when the save itself sets both.
  const next = platformStatus({ core, ready: idNext && secretNext, idSet: idNext, secretSet: secretNext });

  async function save() {
    setBusy(true);
    try {
      const r = await adminApi<{ platforms: Keys; ready: Platform[] }>("/api/admin/platforms", {
        method: "PUT",
        json: { platform: p, clientId: id.trim(), clientSecret: secret === undefined || secret === "" ? undefined : secret, ...(dm ? { dms } : {}), ...(ig ? { insights } : {}) },
      });
      onSaved(r.platforms, r.ready);
      setSecret(undefined);
      const after = platformStatus({ core, ready: r.ready.includes(p), idSet: !!r.platforms[p]?.clientId, secretSet: !!r.platforms[p]?.clientSecret.set });
      toast(savedToast(meta.name, after, core), after === "live" ? undefined : "info");
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
            <Tooltip text={platformHint(status, core)} describe>
              <span tabIndex={0} className="inline-flex rounded-full">
                <StatusBadge status={status} />
              </span>
            </Tooltip>
            {core && <Pill tone="info">Always shown</Pill>}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{s.note}</p>
        </div>
      </div>
      {clash && (
        <p role="alert" className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] leading-snug text-foreground">
          This is the same ID as Facebook, which is the Meta App ID. Instagram login rejects it with &ldquo;Invalid platform app&rdquo;. Paste the Instagram app ID and secret from Instagram &gt; API setup with Instagram login instead.
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 min-w-0 gap-4 [&>*]:min-w-0">
        <div>
          <Label htmlFor={`${p}-id`}>{s.idLabel}</Label>
          <Input id={`${p}-id`} value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono text-[14px]" placeholder={`${meta.name} ${s.idLabel.toLowerCase()}`} />
        </div>
        <SecretField id={`${p}-secret`} label={s.secretLabel} saved={saved.clientSecret} value={secret} onChange={setSecret} placeholder={`Paste the ${s.secretLabel.toLowerCase()}`} />
        <CopyRow label="Callback" value={`${base}/api/accounts/${p}/callback`} />
        {deletion && <CopyRow label="Delete and uninstall callback URL" value={deletion} />}
        {dm && (
          <div className="grid min-w-0 grid-cols-1 gap-2 [&>*]:min-w-0" aria-label="Direct messages setup">
            <p className="text-[12.5px] font-semibold text-foreground">Direct messages</p>
            <label className="flex min-h-[3.25rem] cursor-pointer items-center justify-between gap-3 rounded-2xl bg-secondary/40 px-4 py-2.5 hairline">
              <span className="min-w-0">
                <span className="block text-[14px] font-medium">Ask for the messaging permission</span>
                <span id={`${p}-dms-hint`} className="block text-[12px] leading-snug text-muted-foreground">
                  {dms
                    ? "On: creators are asked to share their messages at login. Leave this on only once Meta has approved messaging for your app."
                    : "Off: login asks only for publishing and comments, so it works while Meta reviews messaging. The Messages tab says DMs are paused."}
                </span>
              </span>
              <Switch on={dms} onChange={setDms} label="Ask for the messaging permission" describedBy={`${p}-dms-hint`} />
            </label>
            {dmsChanged && <p className="text-[12px] text-muted-foreground">Press Save to apply. While this is off, Outlly also pauses syncing and sending direct messages for creators who are already connected.</p>}
            <CopyRow label="Webhook URL" value={dm.webhook} />
            <CopyRow label="Verify token" value={dm.verifyToken} />
            <CopyRow label="Data deletion URL" value={dm.deletion} />
          </div>
        )}
        {ig && (
          <div className="grid min-w-0 grid-cols-1 gap-2 [&>*]:min-w-0" aria-label="Instagram insights">
            <p className="text-[12.5px] font-semibold text-foreground">Insights</p>
            <label className="flex min-h-[3.25rem] cursor-pointer items-center justify-between gap-3 rounded-2xl bg-secondary/40 px-4 py-2.5 hairline">
              <span className="min-w-0">
                <span className="block text-[14px] font-medium">Ask creators for Instagram insights</span>
                <span id="instagram-insights-hint" className="block text-[12px] leading-snug text-muted-foreground">
                  {insights
                    ? "On: every creator is asked to share views, reach and followers at login. Leave this on only once Meta has approved insights for your app."
                    : "Off: creators are not asked, so login keeps working while Meta reviews insights. A super admin signed in here is still asked, for the review recording."}
                </span>
              </span>
              <Switch on={insights} onChange={setInsights} label="Ask creators for Instagram insights" describedBy="instagram-insights-hint" />
            </label>
            {insightsChanged && <p className="text-[12px] text-muted-foreground">Press Save to apply. Creators who are already connected see insights after they reconnect Instagram once.</p>}
          </div>
        )}
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Scopes: <code className="break-all text-[12px]">{scopes}</code>
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || busy} variant="lime">
          {busy ? "Saving…" : dirty ? saveLabel(status, next) : "Save"}
        </Button>
        <a href={s.console} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Open {s.consoleName} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </Card>
  );
}
