"use client";
import { useState } from "react";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { WELCOME_DEFAULT, WELCOME_LIMITS, type WelcomeConfig } from "@/lib/pwa-welcome";
import { cn } from "@/lib/utils";
import { Card, CardTitle } from "./ui";

const input = "h-11 w-full rounded-xl bg-background px-3 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60";

/**
 * Admin > Dashboard style > Home Screen welcome (1100). The once-per-device screen people see the first time
 * they open Outlly from their Home Screen. The switch saves at once; the words save with the button.
 */
export function WelcomeScreenSettings({ initial }: { initial: WelcomeConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const points = [0, 1, 2].map((i) => draft.points[i] ?? "");
  // Compared the way they are saved (trimmed, blanks dropped), so a stray space or empty box never flips Save on.
  const lines = (ps: string[]) => ps.map((p) => p.trim()).filter(Boolean).join("\n");
  const dirty = draft.title.trim() !== cfg.title || draft.body.trim() !== cfg.body || draft.button.trim() !== cfg.button || lines(points) !== lines(cfg.points);

  async function save(patch: Partial<WelcomeConfig>, msg: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await adminApi<{ welcome: WelcomeConfig }>("/api/admin/welcome", { method: "PUT", json: patch });
      setCfg(r.welcome);
      setDraft(r.welcome);
      toast(msg);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, k: "title" | "body" | "button", max: number, hint?: string) => (
    <label className="grid gap-1.5 text-[13px] font-medium">
      <span className="flex justify-between gap-2">
        {label}
        <span className="font-normal text-muted-foreground">{draft[k].length}/{max}</span>
      </span>
      {k === "body" ? (
        <textarea value={draft[k]} maxLength={max} rows={2} disabled={busy} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className={cn(input, "h-auto py-2.5")} />
      ) : (
        <input value={draft[k]} maxLength={max} disabled={busy} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className={input} />
      )}
      {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
    </label>
  );

  return (
    <Card>
      <CardTitle hint="Shown once per device, the first time someone opens Outlly from their Home Screen (iPhone, iPad and Android). Never in a browser tab or inside the Android app. Cookie choice, privacy notice and the tour wait until they press the button. Escape also closes it, and that counts as seen.">
        Home Screen welcome
      </CardTitle>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-secondary/40 px-4 py-3 hairline focus-within:ring-2 focus-within:ring-ring">
        <span className="text-[14px] font-medium">Show a welcome on the first Home Screen launch</span>
        <input
          type="checkbox"
          role="switch"
          checked={cfg.enabled}
          disabled={busy}
          onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Home Screen welcome on." : "Home Screen welcome off for everyone.")}
          className="peer sr-only"
        />
        <span aria-hidden className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200", cfg.enabled ? "bg-lime" : "bg-foreground/20")}>
          <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-background shadow transition-transform duration-200 motion-reduce:transition-none", cfg.enabled ? "translate-x-6" : "translate-x-1")} />
        </span>
      </label>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ title: draft.title.trim(), body: draft.body.trim(), button: draft.button.trim(), points: points.map((p) => p.trim()).filter(Boolean) }, "Welcome screen saved.");
        }}
      >
        {field("Headline", "title", WELCOME_LIMITS.title, "{name} becomes their first name.")}
        {field("Message", "body", WELCOME_LIMITS.body)}
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Ticked lines (leave empty to hide)</legend>
          {points.map((p, i) => (
            <input
              key={i}
              aria-label={`Line ${i + 1}`}
              value={p}
              maxLength={WELCOME_LIMITS.point}
              disabled={busy}
              onChange={(e) => {
                const next = [...points];
                next[i] = e.target.value;
                setDraft({ ...draft, points: next });
              }}
              className={input}
            />
          ))}
        </fieldset>
        {field("Button", "button", WELCOME_LIMITS.button)}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy || !dirty || !draft.title.trim() || !draft.body.trim() || !draft.button.trim()} className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-50">
            Save words
          </button>
          <button type="button" disabled={busy} onClick={() => setDraft({ ...WELCOME_DEFAULT, enabled: cfg.enabled })} className="h-11 rounded-full px-4 text-[14px] font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50">
            Use the default words
          </button>
        </div>
      </form>
    </Card>
  );
}
