"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { qrSvgPath } from "@/lib/otp/qr";
import { saveBlob } from "@/lib/client/native";

type Status = { enabled: boolean; enabledAt: string | null; recoveryLeft: number };
type View = "idle" | "setup" | "codes" | "confirm-off" | "confirm-new";

/** Dark modules on white, always: scanners need the contrast whatever the theme. */
function Qr({ text }: { text: string }) {
  const { d, size } = useMemo(() => qrSvgPath(text), [text]);
  return (
    <svg role="img" aria-label="QR code to add Outlly to your authenticator app" viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 shrink-0 rounded-2xl" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/**
 * Two-step sign-in with an authenticator app (TOTP). Turning it on: scan, type the first code, save the
 * recovery codes. Turning it off or making new recovery codes asks for a current code first.
 */
export function TwoStepCard({ email }: { email: string }) {
  const toast = useToast();
  const [st, setSt] = useState<Status | null>(null);
  const [view, setView] = useState<View>("idle");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  const load = () => api<Status>("/api/settings/2fa").then(setSt).catch(() => setSt({ enabled: false, enabledAt: null, recoveryLeft: 0 }));
  useEffect(() => {
    void load();
  }, []);

  const to = (v: View, focus: "code" | "head" = "code") => {
    setView(v);
    setCode("");
    setError(null);
    requestAnimationFrame(() => (focus === "code" ? codeRef.current : headRef.current)?.focus());
  };
  const call = async <T,>(json: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      return await api<T>("/api/settings/2fa", { method: "POST", json });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const r = await call<{ secret: string; uri: string }>({ action: "setup" });
    if (r) {
      setSetup(r);
      to("setup");
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (view === "setup") {
      const r = await call<{ recoveryCodes: string[] }>({ action: "enable", code });
      if (r) {
        setCodes(r.recoveryCodes);
        setSaved(false);
        setSetup(null);
        to("codes", "head");
        await load();
      }
    } else if (view === "confirm-off") {
      const r = await call({ action: "disable", code });
      if (r) {
        to("idle", "head");
        await load();
        toast("Two-step sign-in is off. Your password or an email code is enough to sign in now.", "ok");
      }
    } else if (view === "confirm-new") {
      const r = await call<{ recoveryCodes: string[] }>({ action: "recovery", code });
      if (r) {
        setCodes(r.recoveryCodes);
        setSaved(false);
        to("codes", "head");
        await load();
      }
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`, "ok");
    } catch {
      toast("Couldn't copy. Select the text and copy it by hand.", "error");
    }
  };
  const download = () => {
    const body = `Outlly recovery codes for ${email}\nEach code works once. Keep them somewhere safe, away from your phone.\n\n${codes.join("\n")}\n`;
    saveBlob(new Blob([body], { type: "text/plain" }), "outlly-recovery-codes.txt").catch(() => toast("Couldn't save the file. Copy the codes instead.", "error"));
  };

  const on = !!st?.enabled;
  const codeField = (label: string, hint?: string) => (
    <div className="max-w-xs">
      <Label htmlFor="tf-code">{label}</Label>
      <Input
        ref={codeRef}
        id="tf-code"
        value={code}
        onChange={(e) => setCode(e.target.value.slice(0, 20))}
        inputMode={view === "setup" ? "numeric" : "text"}
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        required
        placeholder={view === "setup" ? "000000" : "123456 or abcde-12345"}
        aria-describedby={hint ? "tf-hint" : undefined}
        className="tabular text-lg tracking-[0.2em]"
      />
      {hint && <p id="tf-hint" className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <section className="glass rounded-[32px] p-6 sm:p-8 lg:col-span-2" aria-labelledby="tf-h">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="tf-h" ref={headRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
              Two-step sign-in
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {st === null
                ? "Checking…"
                : on
                  ? `On since ${new Date(st.enabledAt!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. After your password, Outlly asks for the code in your authenticator app. ${st.recoveryLeft} recovery code${st.recoveryLeft === 1 ? "" : "s"} left.`
                  : "Add a code from an authenticator app on your phone, so a stolen password alone can't open your studio. You can also sign in any time with a code we email you."}
            </p>
          </div>
        </div>
        {st && view === "idle" && (
          <div className="flex flex-wrap gap-2">
            {on ? (
              <>
                <Button variant="outline" onClick={() => to("confirm-new")}>New recovery codes</Button>
                <Button variant="ghost" onClick={() => to("confirm-off")}>Turn off</Button>
              </>
            ) : (
              <Button variant="primary" onClick={start} disabled={busy}>
                <Smartphone className="h-4 w-4" aria-hidden="true" /> {busy ? "Preparing…" : "Set up authenticator app"}
              </Button>
            )}
          </div>
        )}
      </div>
      {st && on && st.recoveryLeft <= 3 && view === "idle" && (
        <p className="mt-4 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-foreground">Only {st.recoveryLeft} recovery code{st.recoveryLeft === 1 ? "" : "s"} left. Make new ones so you aren't locked out if you lose your phone.</p>
      )}

      {view === "setup" && setup && (
        <form onSubmit={submit} className="mt-6 grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
          <Qr text={setup.uri} />
          <div className="space-y-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Open Google Authenticator, Microsoft Authenticator, 1Password or any authenticator app.</li>
              <li>Add an account and scan this QR code. No camera? Type the key below instead.</li>
              <li>Enter the 6-digit code the app shows for Outlly.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <code className="tabular rounded-xl bg-secondary px-3 py-2 text-sm font-semibold tracking-wide"><span className="sr-only">Setup key: </span>{setup.secret}</code>
              <Button type="button" variant="ghost" onClick={() => copy(setup.secret.replace(/\s/g, ""), "Key")}>
                <Copy className="h-4 w-4" aria-hidden="true" /> Copy key
              </Button>
            </div>
            {codeField("Code from the app")}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={busy || code.replace(/\D/g, "").length !== 6}>{busy ? "Checking…" : "Turn on"}</Button>
              <Button type="button" variant="ghost" onClick={() => { setSetup(null); to("idle", "head"); }}>Cancel</Button>
            </div>
          </div>
        </form>
      )}

      {(view === "confirm-off" || view === "confirm-new") && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {codeField(
            view === "confirm-off" ? "Enter a current code to turn it off" : "Enter a current code to make new recovery codes",
            "The 6-digit code from your app, or one of your recovery codes.",
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={view === "confirm-off" ? "danger" : "primary"} disabled={busy || !code.trim()}>
              {busy ? "Checking…" : view === "confirm-off" ? "Turn off two-step sign-in" : "Make new codes"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => to("idle", "head")}>Cancel</Button>
          </div>
        </form>
      )}

      {view === "codes" && (
        <div className="mt-6 space-y-4">
          <p className="text-sm font-semibold">Save these recovery codes now. They're shown only this once.</p>
          <p className="max-w-xl text-sm text-muted-foreground">If you lose your phone, each code gets you in one time instead of the app code. Keep them in a password manager or on paper, away from the phone.</p>
          <ul className="tabular grid max-w-md grid-cols-2 gap-2 rounded-2xl bg-secondary p-4 text-[15px] font-semibold tracking-wide" aria-label="Recovery codes">
            {codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => copy(codes.join("\n"), "Recovery codes")}><Copy className="h-4 w-4" aria-hidden="true" /> Copy all</Button>
            <Button type="button" variant="outline" onClick={download}><Download className="h-4 w-4" aria-hidden="true" /> Download .txt</Button>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--lime))]" />
            I've saved my recovery codes somewhere safe
          </label>
          <Button type="button" variant="primary" disabled={!saved} onClick={() => { setCodes([]); to("idle", "head"); toast("Two-step sign-in is on.", "ok"); }}>
            <Check className="h-4 w-4" aria-hidden="true" /> Done
          </Button>
        </div>
      )}
      {view === "idle" && error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
  );
}
