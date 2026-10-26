"use client";
import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { WhatsNewCard } from "@/components/shell/WhatsNew";
import { adminApi } from "@/lib/client/admin-api";
import { cleanItems, UPDATE_LIMITS, type UpdateNotice } from "@/lib/updates";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

export function UpdatesEditor({ initial }: { initial: UpdateNotice }) {
  const toast = useToast();
  const [notice, setNotice] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [lines, setLines] = useState(initial.items.join("\n"));
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const items = cleanItems(lines.split("\n"));
  const dirty = title !== notice.title || body !== notice.body || items.join("\n") !== notice.items.join("\n");

  async function save(patch: { publish?: boolean; on?: boolean }) {
    setBusy(true);
    // The on/off switch only flips visibility: it re-sends what is saved, never the unsaved draft.
    const flip = patch.on !== undefined;
    const payload = flip ? { title: notice.title, body: notice.body, items: notice.items, on: patch.on, publish: false } : { title, body, items, on: notice.on, publish: !!patch.publish };
    try {
      const r = await adminApi<{ notice: UpdateNotice }>("/api/admin/updates", { method: "PUT", json: payload });
      setNotice(r.notice);
      if (!flip) setLines(r.notice.items.join("\n"));
      toast(patch.publish ? "Published. Members see it the next time they open their dashboard." : patch.on === undefined ? "Saved. People who already closed it will not see it again." : patch.on ? "Notice is on" : "Notice is off. Nobody sees it.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setAsk(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <Card>
        <CardTitle
          hint={notice.on ? `Published ${new Date(notice.publishedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}` : "Switched off. Nobody sees it."}
          action={<Pill tone={notice.on ? "ok" : "muted"}>{notice.on ? "Showing" : "Off"}</Pill>}
        >
          What changed
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", notice.on ? "bg-success/10" : "bg-secondary/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", notice.on ? "bg-success/15 text-success" : "bg-foreground/10 text-muted-foreground")}>
              <Megaphone className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-[15px] font-semibold">{notice.on ? "Members who have not closed it yet will see it" : "The notice is hidden"}</p>
              <p className="text-[12.5px] text-muted-foreground">Shown once per member, on the dashboard. New sign-ups skip it.</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notice.on}
            aria-label="Show the update notice"
            disabled={busy}
            onClick={() => save({ on: !notice.on })}
            className={cn("relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", notice.on ? "bg-success" : "bg-foreground/20")}
          >
            <span className={cn("inline-block h-7 w-7 rounded-full bg-white shadow transition-transform duration-300", notice.on ? "translate-x-8" : "translate-x-1")} />
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <div>
            <Label htmlFor="up-title">Title</Label>
            <Input id="up-title" className="mt-1.5" maxLength={UPDATE_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="We made a few changes for you" />
          </div>
          <div>
            <Label htmlFor="up-body">Short note</Label>
            <Textarea id="up-body" className="mt-1.5" rows={3} maxLength={UPDATE_LIMITS.body} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="mt-1 text-[12px] text-muted-foreground">{body.length}/{UPDATE_LIMITS.body}</p>
          </div>
          <div>
            <Label htmlFor="up-items">Changes, one per line</Label>
            <Textarea id="up-items" className="mt-1.5" rows={7} value={lines} onChange={(e) => setLines(e.target.value)} aria-describedby="up-items-hint" />
            <p id="up-items-hint" className="mt-1 text-[12px] text-muted-foreground">
              {items.length}/{UPDATE_LIMITS.items} shown. Say what the member gets, in plain words. Up to {UPDATE_LIMITS.item} characters each.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="lime" disabled={busy || !title.trim() || (!items.length && !body.trim())} onClick={() => setAsk(true)}>
            <Send className="h-4 w-4" aria-hidden /> Publish to members
          </Button>
          <Button type="button" variant="subtle" disabled={busy || !dirty || !title.trim()} onClick={() => save({})}>
            Save quietly
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Save quietly fixes a typo without showing it again to people who already closed it.</p>
      </Card>

      <Card>
        <CardTitle hint="Exactly what members see. It follows their light or dark theme.">Preview</CardTitle>
        <div className="grid place-items-center rounded-[24px] bg-[radial-gradient(120%_90%_at_15%_0%,#0d2a1c,#030705_70%)] p-4 sm:p-6">
          <WhatsNewCard preview notice={{ title, body, items, publishedAt: notice.publishedAt }} />
        </div>
      </Card>

      <ConfirmDialog
        open={ask}
        onOpenChange={setAsk}
        tone="primary"
        title="Show this to every member?"
        body="Everyone who joined before now sees it once, the next time they open their dashboard. Anyone who closed an older notice sees this one too."
        confirmLabel="Publish"
        cancelLabel="Not yet"
        busy={busy}
        onConfirm={() => save({ publish: true })}
      />
    </div>
  );
}
