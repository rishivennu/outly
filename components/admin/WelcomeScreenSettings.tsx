"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { WELCOME_DEFAULT, WELCOME_LIMITS, type WelcomeConfig } from "@/lib/pwa-welcome";
import { Card, CardTitle } from "./ui";
import { Switch } from "./Switch";

/**
 * Admin > Dashboard style > Home Screen welcome (1100). The once-per-device screen people see the first time
 * they open Outlly from their Home Screen. The switch saves at once; the words save with the button.
 * 1101: headline, screen-reader description and the four action labels; the ticked lines are gone.
 */
export function WelcomeScreenSettings({ initial }: { initial: WelcomeConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  // 1101: the screen shows a headline and four actions (the ticked lines went with the redesign).
  // Compared the way they are saved (trimmed), so a stray space never flips Save on.
  const WORDS = ["title", "body", "button", "connect", "tour", "skip"] as const;
  const dirty = WORDS.some((k) => draft[k].trim() !== cfg[k]);
  const blank = WORDS.some((k) => !draft[k].trim());

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

  const field = (label: string, k: (typeof WORDS)[number], max: number, hint?: string) => (
    <label className="grid gap-1.5 text-[13px] font-medium">
      <span className="flex justify-between gap-2">
        {label}
        <span className="font-normal text-muted-foreground">{draft[k].length}/{max}</span>
      </span>
      {k === "body" ? (
        <Textarea value={draft[k]} maxLength={max} rows={2} disabled={busy} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className="text-[14px] disabled:opacity-60" />
      ) : (
        <Input value={draft[k]} maxLength={max} disabled={busy} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className="h-11 text-[14px] disabled:opacity-60" />
      )}
      {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
    </label>
  );

  return (
    <Card>
      <CardTitle hint="Shown every time someone comes into Outlly: a new browser tab, a launch from the Home Screen or the Android app, or signing in. Once per visit, so moving between pages or reloading does not bring it back. Cookie choice, privacy notice and the tour wait until they press the button. Escape also closes it.">
        Welcome screen
      </CardTitle>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-secondary/40 px-4 py-3">
        <span className="text-[14px] font-medium">Show a welcome each time someone comes into Outlly</span>
        <Switch on={cfg.enabled} disabled={busy} label="Show a welcome each time someone comes into Outlly" onChange={(v) => save({ enabled: v }, v ? "Welcome screen on." : "Welcome screen off for everyone.")} />
      </label>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save(Object.fromEntries(WORDS.map((k) => [k, draft[k].trim()])) as Partial<WelcomeConfig>, "Welcome screen saved.");
        }}
      >
        {field("Headline", "title", WELCOME_LIMITS.title, "One line per sentence; the last word is the lime highlight. {greeting} becomes Good morning, Good afternoon or Good evening on their clock; {name} becomes their first name.")}
        {field("Description for screen readers", "body", WELCOME_LIMITS.body, "Read aloud after the headline; not shown on screen.")}
        {field("Main button", "button", WELCOME_LIMITS.button, "Closes the welcome onto the page it opened on.")}
        {field("Second button", "connect", WELCOME_LIMITS.connect, "Opens Accounts to connect a platform.")}
        {field("Third button", "tour", WELCOME_LIMITS.tour, "Starts the guided tour.")}
        {field("Text link", "skip", WELCOME_LIMITS.skip, "Goes to the dashboard (Home).")}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="lime" disabled={busy || !dirty || blank}>
            Save words
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft({ ...WELCOME_DEFAULT, enabled: cfg.enabled })}>
            Use the default words
          </Button>
        </div>
      </form>
    </Card>
  );
}
