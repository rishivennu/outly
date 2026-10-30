"use client";
import { useEffect, useState } from "react";
import { Laptop, LogOut, MonitorSmartphone, ShieldCheck, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { forgetBillingCopies } from "@/lib/client/forget-billing";

type Device = { id: string; label: string; place: string | null; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * Remembered devices (1053): browsers that skip the second sign-in step for 30 days. Forgetting one means it
 * asks for the code again next time; it doesn't sign anyone out right now (that's "Sign out everywhere").
 */
export function RememberedDevicesCard({ twoStepNote = true }: { twoStepNote?: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<Device[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [askAll, setAskAll] = useState(false);

  const load = () =>
    api<{ devices: Device[] }>("/api/me/devices")
      .then((r) => {
        setList(r.devices);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    void load();
  }, []);

  const forget = async (id: string | "all") => {
    setBusy(id);
    try {
      const r = await api<{ devices: Device[] }>(id === "all" ? "/api/me/devices?all=1" : `/api/me/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setList(r.devices);
      setAskAll(false);
      toast(id === "all" ? "Every device will ask for the second step again." : "Forgotten. That device will ask for the second step next time.", "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't forget that device. Try again.", "error");
      if (e instanceof ApiError && e.status === 404) void load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="rd-h" aria-busy={list === null && !failed}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="rd-h" className="text-2xl font-semibold tracking-tight">Remembered devices</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            When you choose &ldquo;Remember this device&rdquo; at sign-in, that browser stays signed in and{twoStepNote ? " skips the two-step code for 30 days" : " is listed here"}. Signing out on it, or changing your password, forgets it.
          </p>
        </div>
        {!!list?.length && (
          <Button variant="ghost" onClick={() => setAskAll(true)} disabled={busy !== null}>
            Forget all
          </Button>
        )}
      </div>
      {failed ? (
        <p role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-destructive">
          Couldn&apos;t load your devices.
          <Button variant="outline" onClick={() => void load()}>Try again</Button>
        </p>
      ) : list === null ? (
        <ul className="mt-4 space-y-2" aria-hidden="true">
          {[0, 1].map((i) => <li key={i} className="h-16 animate-pulse rounded-2xl bg-secondary/50" />)}
        </ul>
      ) : list.length === 0 ? (
        <p className="mt-4 flex items-center gap-3 rounded-2xl bg-secondary/40 p-4 text-sm text-muted-foreground">
          <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          No remembered devices. Every sign-in asks for each step you have turned on.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60 overflow-hidden rounded-2xl hairline">
          {list.map((d) => {
            const Ico = /Android|iPhone/.test(d.label) ? Smartphone : Laptop;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <Ico className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    {d.label}
                    {d.current && <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-semibold text-lime-ink">This device</span>}
                  </p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {d.place ? <>Around {d.place} (approximate) · </> : null}Last used {day(d.lastUsedAt)} · Until {day(d.expiresAt)}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => forget(d.id)} disabled={busy !== null} aria-label={`Forget ${d.label}${d.current ? " (this device)" : ""}`}>
                  <X className="h-4 w-4" aria-hidden="true" /> {busy === d.id ? "Forgetting…" : "Forget"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={askAll}
        onOpenChange={setAskAll}
        title="Forget every remembered device?"
        body="Each one will ask for the two-step code at its next sign-in. Nobody is signed out right now."
        confirmLabel="Forget all"
        cancelLabel="Keep them"
        busy={busy === "all"}
        onConfirm={() => forget("all")}
      />
    </section>
  );
}

/** Sign out here, or everywhere (moved from Your data in 1053). Everywhere asks first: it also signs this device out. */
export function SessionsCard() {
  const toast = useToast();
  const [busy, setBusy] = useState<"one" | "all" | null>(null);
  const [ask, setAsk] = useState(false);

  const here = async () => {
    setBusy("one");
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      await forgetBillingCopies();
      window.location.href = "/login";
    }
  };
  const everywhere = async () => {
    setBusy("all");
    try {
      await api("/api/auth/logout-all", { method: "POST" });
      await forgetBillingCopies();
      window.location.href = "/login";
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't sign out everywhere. Try again in a moment.", "error");
      setBusy(null);
      setAsk(false);
    }
  };

  return (
    <section className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="ss-h">
      <h2 id="ss-h" className="text-2xl font-semibold tracking-tight">Sessions</h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">Your drafts and schedule stay put whichever you pick.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={here} disabled={busy !== null}>
          <LogOut className="h-4 w-4" aria-hidden="true" /> {busy === "one" ? "Signing out…" : "Sign out"}
        </Button>
        <Button variant="ghost" onClick={() => setAsk(true)} disabled={busy !== null}>
          <MonitorSmartphone className="h-4 w-4" aria-hidden="true" /> Sign out everywhere
        </Button>
      </div>
      <ConfirmDialog
        open={ask}
        onOpenChange={setAsk}
        title="Sign out everywhere?"
        body="Every phone and computer signed in to Outlly is signed out, this one included, and remembered devices are forgotten. Handy after using a shared device."
        confirmLabel="Sign out everywhere"
        cancelLabel="Stay signed in"
        busy={busy === "all"}
        onConfirm={everywhere}
      />
    </section>
  );
}
