"use client";
import { GoogleHelp } from "@/components/onboarding/GoogleHelp";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, BarChart3, Check, CircleAlert, KeyRound, Lock, Unplug } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { Collectible, useTilt } from "@/components/shared/Collectible";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import { api, ApiError } from "@/lib/client/api";
import { EXTRA_PLATFORMS, PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { cn } from "@/lib/utils";
import type { AccountView } from "@/lib/services";

const RIM: Record<Platform, string> = { instagram: "330 90% 66%", youtube: "2 95% 64%", x: "222 95% 66%", tiktok: "178 85% 55%", threads: "0 0% 80%", facebook: "214 95% 64%", linkedin: "201 85% 58%" };

/** The 3D marker shows the connection at a glance; the badge next to it states the exact status. */
const STATE_ICON: Record<"connected" | "needs_reconnect" | "disconnected", IconName> = { connected: "connected", needs_reconnect: "reconnect", disconnected: "disconnected" };

const BLURB: Record<Platform, string> = {
  instagram: "Reels, with captions and hashtags that travel.",
  youtube: "Shorts, with titles people actually search for.",
  x: "Video posts, short and sharp.",
  tiktok: "Vertical videos, straight to your profile.",
  threads: "Video posts with room to talk.",
  facebook: "Reels on your Facebook Page.",
  linkedin: "Native video posts for your network.",
};

export type ConnectSetup = Record<Platform, { oauth: boolean; token: boolean }>;

const ERRORS: Record<string, (name: string) => string> = {
  not_configured: (n) => `${n} isn't set up on this server yet, so there's nothing to connect to.`,
  access_denied: (n) => `${n} didn't give access. While the app is in testing, only approved testers can connect. The help on the card below shows how to get added.`,
  state: () => "That sign-in took too long or came from another tab. Let's start it again.",
  exchange: (n) => `${n} signed you in, but the last step failed. What ${n} said is shown on this page.`,
  config: (n) => `${n} turned this server away: its app ID or secret doesn't match the ${n} app. Ask the admin to check both in Admin > Social platforms.`,
  redirect: (n) => `${n} doesn't know this site's return address yet. The admin needs to copy the callback URL from Admin > Social platforms into the ${n} app's OAuth redirect URIs, exactly as shown.`,
  server: () => "You signed in fine, but we couldn't save the connection on our side. Give it a minute and try again.",
  no_channel: () => "That Google account doesn't have a YouTube channel yet. Create one on youtube.com (it takes a minute), then connect again.",
  wrong_app_id: () => "Instagram login isn't set up right on this server yet (it has the Facebook app ID, not the Instagram one). Connect with a token below for now, or ask the admin to fix it in Admin > Social platforms.",
  owner_only: (n) => `Only the workspace owner can connect ${n}. Ask them to connect it, or switch to your own studio.`,
};

export function AccountsView({ initial, setup }: { initial: AccountView[]; setup: ConnectSetup }) {
  const [accounts, setAccounts] = useState(initial);
  const [confirm, setConfirm] = useState<Platform | null>(null);
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [fail, setFail] = useState<{ name: string; detail: string } | null>(null);
  const errorReason = params.get("connect_error") === "youtube" ? params.get("reason") : null;
  const tilt = useTilt(12);
  const live = useLivePlatforms();
  const soon = EXTRA_PLATFORMS.filter((p) => !live.includes(p));

  useEffect(() => {
    const c = params.get("connected");
    const e = params.get("connect_error");
    if (c && (PLATFORMS as readonly string[]).includes(c)) {
      if (params.get("notice") === "dm_scope") toast(`${PLATFORM_META[c as Platform].name} is connected, but messages were left unticked, so DMs won't arrive in your Inbox. To get them, reconnect and keep "Manage messages" ticked.`, "info");
      else toast(`${PLATFORM_META[c as Platform].name} is connected. Ready to publish.`);
    }
    if (e) {
      const name = (PLATFORMS as readonly string[]).includes(e) ? PLATFORM_META[e as Platform].name : "The platform";
      const reason = params.get("reason") ?? "";
      toast((ERRORS[reason] ?? (() => "That connection didn't go through. Let's try again."))(name), "info");
      const m = /(?:^|;\s*)outlly-connect-detail=([^;]*)/.exec(document.cookie);
      if (m) {
        try {
          setFail({ name, detail: decodeURIComponent(m[1]).slice(0, 240) });
        } catch {}
        document.cookie = "outlly-connect-detail=; path=/; max-age=0";
      }
    }
    if (c || e) router.replace("/accounts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [busy, setBusy] = useState(false);

  const disconnect = async (p: Platform) => {
    setBusy(true);
    try {
      await api(`/api/accounts/${p}`, { method: "DELETE" });
      setAccounts((a) => a.filter((x) => x.platform !== p));
      setConfirm(null);
      toast(`${PLATFORM_META[p].name} is disconnected. We deleted its keys.`, "info");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something got in the way.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
      <p className="eyebrow mb-3">Connected accounts</p>
      <h1 className="display max-w-3xl text-[clamp(2.6rem,6vw,4.6rem)]">Where should we send your content?</h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        You sign in on each platform&apos;s own page. We never see your password, and every key we keep is encrypted.
        {" Every account you connect here is your real one: posts go live and the numbers are real."}
      </p>

      {fail && (
        <div role="alert" className="mt-6 max-w-2xl rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="font-medium">{fail.name} didn&apos;t connect. What {fail.name} told us:</p>
          <p className="mt-1 break-words font-mono text-[13px] text-foreground/85">{fail.detail}</p>
          <p className="mt-2 text-foreground/75">Send this line to whoever looks after the app keys. It holds no passwords or tokens.</p>
          <button type="button" onClick={() => setFail(null)} className="mt-2 min-h-11 underline underline-offset-2">
            Hide this
          </button>
        </div>
      )}

      <ul className="mt-10 grid gap-4 md:grid-cols-3">
        {live.map((p, i) => {
          const a = accounts.find((x) => x.platform === p);
          const ok = a?.status === "connected";
          return (
            <motion.li key={p} id={p} data-guide={i === 0 ? "acct-first" : undefined} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} {...tilt} className={cn("glass relative flex flex-col overflow-hidden rounded-[32px] p-6", ok && "neon-rim")} style={{ ["--halo" as string]: PLATFORM_HALO[p], ["--rim" as string]: RIM[p] }}>
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20 blur-3xl" style={{ background: PLATFORM_HALO[p] }} aria-hidden="true" />
              <div className="relative -ml-2 -mt-2 h-[150px]">
                <Collectible platform={p} size={112} state={ok ? "ready" : a ? "reconnect" : "sealed"} />
              </div>
              <div className="relative mt-5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-tight">{PLATFORM_META[p].name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{BLURB[p]}</p>
                </div>
                <Icon3D name={STATE_ICON[ok ? "connected" : a ? "needs_reconnect" : "disconnected"]} size={52} className="shrink-0" />
              </div>
              <StatusBadge status={ok ? "connected" : a ? "needs_reconnect" : "disconnected"} className="relative mt-4 self-start" />

              <div className="mt-6 flex-1">
                {a && (
                  <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
                    <span className="lime-bg grid h-9 w-9 place-items-center rounded-full text-sm font-bold" aria-hidden="true">
                      {a.username.replace(/^@/, "").slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.username}</p>
                      <p className={cn("flex items-center gap-1 text-xs", ok ? "text-success" : "text-warning")}>
                        {ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />}
                        {ok ? "Ready to publish" : `${PLATFORM_META[p].name} needs you to reconnect.`}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {!ok && !setup[p].oauth && !setup[p].token && (
                <p className="relative mt-4 flex gap-2 rounded-2xl bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {PLATFORM_META[p].name} isn&apos;t switched on yet. An admin adds its app keys in Admin &gt; Social platforms, and it goes live right away.
                  </span>
                </p>
              )}
              {!ok && setup[p].oauth && (
                <p className="relative mt-4 flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {p === "youtube"
                    ? "You sign in on Google's own page and pick the channel. Outlly never sees your password."
                    : `You log in on ${PLATFORM_META[p].name}'s own page. Outlly never sees your password.`}
                </p>
              )}
              {!ok && p === "youtube" && setup.youtube.oauth && errorReason === "access_denied" && <GoogleHelp className="relative mt-3" defaultOpen />}
              {!ok && p === "instagram" && !setup.instagram.oauth && setup.instagram.token && (
                <p className="relative mt-4 flex gap-2 rounded-2xl bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    &ldquo;Log in with Instagram&rdquo; switches on once an admin adds the Instagram app ID and secret in Admin &gt; Social platforms. Until then, connect with a token below.
                  </span>
                </p>
              )}

              {setup[p].token && !ok && <TokenConnect defaultOpen={!setup[p].oauth} onConnected={(acc) => setAccounts((all) => [...all.filter((x) => x.platform !== p), acc])} />}

              <div className="mt-6 flex flex-wrap gap-2">
                {!ok && setup[p].oauth && (
                  <Button asChild variant={a ? "primary" : "lime"} className="flex-1">
                    <a href={`/api/accounts/${p}/connect?returnTo=/accounts`}>
                      {a ? "Reconnect" : p === "youtube" ? "Sign in with Google" : `Log in with ${PLATFORM_META[p].name}`} <ArrowRight className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                {ok && (
                  <Button asChild variant="primary" className="flex-1">
                    <Link href={`/analytics/${p}`}>
                      <BarChart3 className="h-4 w-4" /> Open dashboard
                    </Link>
                  </Button>
                )}
                {a && (
                  <Button variant="ghost" onClick={() => setConfirm(p)}>
                    <Unplug className="h-4 w-4" /> Disconnect
                  </Button>
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `Disconnect ${PLATFORM_META[confirm].name}?` : ""}
        body="We delete the keys we hold for it. Anything already published stays up, and scheduled posts for this destination will stop going out until you reconnect."
        confirmLabel="Yes, disconnect"
        busy={busy}
        onConfirm={() => confirm && disconnect(confirm)}
      />

      {soon.length > 0 && (
        <section className="mt-12" aria-labelledby="soon">
          <h2 id="soon" className="eyebrow mb-4">
            Coming next
          </h2>
          <ul className="flex flex-wrap gap-2">
            {soon.map((p) => (
              <li key={p} className="inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm text-muted-foreground hairline">
                <PlatformOrb platform={p} size={26} /> {PLATFORM_META[p].name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Paste a long-lived Instagram token from the Meta app dashboard. The token is sent once and stored encrypted. */
function TokenConnect({ onConnected, defaultOpen }: { onConnected: (a: AccountView) => void; defaultOpen?: boolean }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ account: AccountView }>("/api/accounts/instagram/token", { method: "POST", json: { token } });
      setToken("");
      onConnected(r.account);
      toast(`Instagram ${r.account.username} is connected for real. Your live dashboard is ready.`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "That token didn't work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details open={defaultOpen} className="group relative mt-4 rounded-2xl bg-secondary/40 px-4 py-3 text-sm">
      <summary className="flex min-h-[28px] cursor-pointer list-none items-center gap-2 text-muted-foreground hover:text-foreground">
        <KeyRound className="h-4 w-4" aria-hidden="true" /> {defaultOpen ? "Connect with an access token" : "Have an access token?"}
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-2">
        <label htmlFor="ig-token" className="text-xs text-muted-foreground">
          Meta app dashboard → Instagram → API setup with Instagram login → Generate token
        </label>
        <input
          id="ig-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="IGAA…"
          className="h-11 w-full rounded-xl bg-background px-3 font-mono text-xs outline-none hairline focus-visible:ring-2 focus-visible:ring-lime"
        />
        {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
        <Button type="submit" variant="primary" size="sm" disabled={busy || token.trim().length < 40} className="w-full">
          {busy ? "Checking with Instagram…" : "Connect with token"}
        </Button>
      </form>
    </details>
  );
}

const names = (ps: Platform[]) => ps.map((p) => PLATFORM_META[p].name).join(ps.length === 2 ? " and " : ", ");

