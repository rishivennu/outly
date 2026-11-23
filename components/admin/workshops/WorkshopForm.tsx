"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/shared/Sheet";
import { adminApi } from "@/lib/client/admin-api";
import { LEVEL_LABEL, WORKSHOP_LEVELS, slugify, type WorkshopLevel, type WorkshopView } from "@/lib/workshops/core";
import { ZONES, isoToZoned, zonedToIso } from "./time";

type Draft = {
  title: string; slug: string; summary: string; description: string; host: string; level: WorkshopLevel; tags: string;
  date: string; start: string; end: string; timezone: string; capacity: string; coverUrl: string; meetUrl: string; recordingUrl: string;
};

const DEFAULT_TZ = "Asia/Kolkata";

function draftOf(w: WorkshopView | null): Draft {
  if (!w) {
    const d = isoToZoned(new Date(Date.now() + 7 * 86400_000).toISOString(), DEFAULT_TZ);
    return { title: "", slug: "", summary: "", description: "", host: "", level: "all", tags: "", date: d.date, start: "19:00", end: "20:00", timezone: DEFAULT_TZ, capacity: "0", coverUrl: "", meetUrl: "", recordingUrl: "" };
  }
  const s = isoToZoned(w.startsAt, w.timezone), e = isoToZoned(w.endsAt, w.timezone);
  return {
    title: w.title, slug: w.slug, summary: w.summary, description: w.description, host: w.host, level: w.level, tags: w.tags.join(", "),
    date: s.date, start: s.time, end: e.time, timezone: w.timezone, capacity: String(w.capacity), coverUrl: w.coverUrl, meetUrl: w.meetUrl ?? "", recordingUrl: w.recordingUrl,
  };
}

/** An end time at or before the start means the session runs past midnight into the next day. */
function times(f: Draft) {
  const startsAt = zonedToIso(f.date, f.start, f.timezone);
  let endsAt = zonedToIso(f.date, f.end, f.timezone);
  if (new Date(endsAt) <= new Date(startsAt)) {
    const next = new Date(`${f.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    endsAt = zonedToIso(next.toISOString().slice(0, 10), f.end, f.timezone);
  }
  return { startsAt, endsAt };
}

type Saved = { workshop: WorkshopView };
type Mode = "draft" | "publish" | "save";

export function WorkshopForm({ open, onOpenChange, workshop, calendarConnected, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; workshop: WorkshopView | null; calendarConnected: boolean; onSaved: (w: WorkshopView) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={workshop ? "Edit workshop" : "New workshop"} description={workshop ? workshop.title : "Drafts stay private until you publish."}>
      {open && <FormBody key={workshop?.id ?? "new"} workshop={workshop} calendarConnected={calendarConnected} onSaved={onSaved} />}
    </Sheet>
  );
}

function FormBody({ workshop, calendarConnected, onSaved }: { workshop: WorkshopView | null; calendarConnected: boolean; onSaved: (w: WorkshopView) => void }) {
  const [f, setF] = useState<Draft>(() => draftOf(workshop));
  const [slugEdited, setSlugEdited] = useState(!!workshop);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(mode: Mode) {
    setError("");
    let when: { startsAt: string; endsAt: string };
    try {
      when = times(f);
    } catch (e: any) {
      return setError(e.message);
    }
    const body = {
      title: f.title, slug: f.slug || undefined, summary: f.summary, description: f.description, host: f.host, level: f.level,
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      ...when, timezone: f.timezone, capacity: Math.max(0, Math.floor(Number(f.capacity) || 0)),
      coverUrl: f.coverUrl.trim(), meetUrl: f.meetUrl.trim(), recordingUrl: f.recordingUrl.trim(),
    };
    setBusy(mode);
    try {
      const r = workshop
        ? await adminApi<Saved>(`/api/admin/workshops/${workshop.id}`, { method: "PATCH", json: { workshop: body, ...(mode === "publish" ? { status: "published" } : {}) } })
        : await adminApi<Saved>("/api/admin/workshops", { method: "POST", json: { workshop: body, publish: mode === "publish" } });
      onSaved(r.workshop);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const id = (k: string) => `ws-${k}`;
  const text = (k: "title" | "host" | "coverUrl" | "meetUrl" | "recordingUrl", label: string, opts: { placeholder?: string; hint?: string; type?: string } = {}) => (
    <div>
      <Label htmlFor={id(k)}>{label}</Label>
      <Input
        id={id(k)}
        type={opts.type ?? "text"}
        value={f[k]}
        placeholder={opts.placeholder}
        aria-describedby={opts.hint ? `${id(k)}-hint` : undefined}
        onChange={(e) => {
          const v = e.target.value;
          setF((x) => ({ ...x, [k]: v, ...(k === "title" && !slugEdited ? { slug: slugify(v) } : {}) }));
        }}
      />
      {opts.hint && <p id={`${id(k)}-hint`} className="mt-1.5 text-[12.5px] text-muted-foreground">{opts.hint}</p>}
    </div>
  );
  const select = "h-12 w-full cursor-pointer appearance-none rounded-2xl bg-secondary/60 px-4 text-base text-foreground field-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]";
  const isDraft = !workshop || workshop.status === "draft";

  return (
    <form
      className="grid gap-4 pt-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(workshop ? "save" : "draft");
      }}
    >
      {text("title", "Title", { placeholder: "Hooks that hold the first 3 seconds" })}
      <div>
        <Label htmlFor={id("slug")}>Slug</Label>
        <Input id={id("slug")} value={f.slug} spellCheck={false} autoComplete="off" className="font-mono text-[14px]" aria-describedby={`${id("slug")}-hint`} onChange={(e) => { setSlugEdited(true); set("slug", slugify(e.target.value)); }} />
        <p id={`${id("slug")}-hint`} className="mt-1.5 text-[12.5px] text-muted-foreground">outlly.com/workshops/{f.slug || "…"}</p>
      </div>
      <div>
        <Label htmlFor={id("summary")}>
          Summary <Counter value={f.summary.length} max={200} />
        </Label>
        <Input id={id("summary")} value={f.summary} maxLength={200} onChange={(e) => set("summary", e.target.value)} placeholder="One line for the card." />
      </div>
      <div>
        <Label htmlFor={id("description")}>Description</Label>
        <Textarea id={id("description")} value={f.description} rows={6} maxLength={8000} onChange={(e) => set("description", e.target.value)} placeholder="What creators will learn, what to bring." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("host", "Host", { placeholder: "Rishi" })}
        <div>
          <Label htmlFor={id("level")}>Level</Label>
          <select id={id("level")} value={f.level} onChange={(e) => set("level", e.target.value as WorkshopLevel)} className={select}>
            {WORKSHOP_LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor={id("tags")}>Tags</Label>
        <Input id={id("tags")} value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="hooks, reels, editing" aria-describedby={`${id("tags")}-hint`} />
        <p id={`${id("tags")}-hint`} className="mt-1.5 text-[12.5px] text-muted-foreground">Separate with commas. Up to 8.</p>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[13px] font-semibold">When</legend>
        <div>
          <Label htmlFor={id("date")}>Date</Label>
          <Input id={id("date")} type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={id("tz")}>Time zone</Label>
          <select id={id("tz")} value={f.timezone} onChange={(e) => set("timezone", e.target.value)} className={select}>
            {(ZONES as readonly string[]).includes(f.timezone) ? null : <option value={f.timezone}>{f.timezone}</option>}
            {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={id("start")}>Starts</Label>
          <Input id={id("start")} type="time" value={f.start} onChange={(e) => set("start", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={id("end")}>Ends</Label>
          <Input id={id("end")} type="time" value={f.end} onChange={(e) => set("end", e.target.value)} />
        </div>
      </fieldset>

      <div>
        <Label htmlFor={id("capacity")}>Capacity</Label>
        <Input id={id("capacity")} type="number" inputMode="numeric" min={0} value={f.capacity} onChange={(e) => set("capacity", e.target.value)} aria-describedby={`${id("capacity")}-hint`} />
        <p id={`${id("capacity")}-hint`} className="mt-1.5 text-[12.5px] text-muted-foreground">0 keeps seats open.</p>
      </div>
      {text("coverUrl", "Cover image URL", { type: "url", placeholder: "https://" })}
      {text("meetUrl", "Meet link", {
        type: "url",
        placeholder: "https://",
        hint: calendarConnected
          ? "Filled automatically from Google Meet when the calendar is connected. Paste one only if you host elsewhere."
          : "Google Calendar is not connected, so paste the link creators should join.",
      })}
      {text("recordingUrl", "Recording URL", { type: "url", placeholder: "https://", hint: "Add after the session so past workshops can be rewatched." })}

      {error && <p role="alert" className="rounded-2xl bg-destructive/[0.08] px-4 py-3 text-[13px] font-medium text-[hsl(0_72%_38%)] dark:text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2 pt-2">
        {workshop ? (
          <>
            <Button type="submit" variant={isDraft ? "outline" : "lime"} className="flex-1" disabled={!!busy}>{busy === "save" ? "Saving…" : "Save changes"}</Button>
            {isDraft && <Button type="button" variant="lime" className="flex-1" disabled={!!busy} onClick={() => submit("publish")}>{busy === "publish" ? "Publishing…" : "Save & publish"}</Button>}
          </>
        ) : (
          <>
            <Button type="submit" variant="outline" className="flex-1" disabled={!!busy}>{busy === "draft" ? "Saving…" : "Save draft"}</Button>
            <Button type="button" variant="lime" className="flex-1" disabled={!!busy} onClick={() => submit("publish")}>{busy === "publish" ? "Publishing…" : "Save & publish"}</Button>
          </>
        )}
      </div>
    </form>
  );
}
