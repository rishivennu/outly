"use client";
import { useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { BLOG_TONES, blogConfigIssues, type BlogConfig, type BlogFeatureRef } from "@/lib/blog/config";
import { Card, CardTitle, Pill } from "../ui";
import { Switch } from "@/components/admin/Switch";

/** R1175 Blog settings: who the agent writes for, what it may say, and when it runs. Publishing stays manual. */
export function BlogSettingsForm({ initial, ready, web, modelLabel }: { initial: BlogConfig; ready: boolean; web: boolean; modelLabel: string }) {
  const [c, setC] = useState<BlogConfig>(initial);
  const [saved, setSaved] = useState<BlogConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const dirty = JSON.stringify(c) !== JSON.stringify(saved);
  const issues = blogConfigIssues(c);
  const set = <K extends keyof BlogConfig>(k: K, v: BlogConfig[K]) => setC((x) => ({ ...x, [k]: v }));

  async function save(patch: Partial<BlogConfig> = c) {
    setBusy(true);
    setErr(null);
    try {
      const r = await adminApi<{ config: BlogConfig }>("/api/admin/blog/settings", { method: "PUT", json: patch });
      setC(r.config);
      setSaved(r.config);
      toast("Blog settings saved");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!issues.length) save();
      }}
      className="grid gap-5"
    >
      <Card as="div" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <Pill tone={c.paused ? "warn" : "ok"}>{c.paused ? "Agent paused" : "Agent active"}</Pill>
          <Pill tone={ready ? "ok" : "bad"}>{ready ? "AI key set" : "No AI key"}</Pill>
          <Pill tone={web ? "ok" : "warn"}>{web ? "Web research on" : "No web research"}</Pill>
          <Pill tone="muted">Model: {modelLabel}</Pill>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => save({ paused: !saved.paused })}>
            {saved.paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
            {saved.paused ? "Resume agent" : "Pause agent"}
          </Button>
          <Button type="submit" variant="lime" className="min-h-11" disabled={!dirty || busy || issues.length > 0}>
            {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />} Save settings
          </Button>
        </div>
        {(err || issues[0]) && (
          <p role="alert" className="basis-full text-[13.5px] text-destructive">
            {err ?? issues[0]}
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Audience and voice</CardTitle>
          <div className="mt-4 grid gap-4">
            <F id="aud" label="Who the articles are for">
              <Textarea id="aud" rows={3} value={c.audience} onChange={(e) => set("audience", e.target.value)} maxLength={600} />
            </F>
            <F id="tone" label="Tone">
              <select id="tone" value={c.tone} onChange={(e) => set("tone", e.target.value as BlogConfig["tone"])} className="field min-h-11 rounded-xl border border-border bg-card px-3 text-[14px] capitalize">
                {BLOG_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </F>
            <div className="grid grid-cols-2 gap-4">
              <F id="min" label="Minimum words">
                <Input id="min" type="number" inputMode="numeric" min={300} max={3000} value={c.minWords} onChange={(e) => set("minWords", Number(e.target.value))} />
              </F>
              <F id="max" label="Maximum words">
                <Input id="max" type="number" inputMode="numeric" min={300} max={4000} value={c.maxWords} onChange={(e) => set("maxWords", Number(e.target.value))} />
              </F>
            </div>
            <F id="author" label="Author shown on articles">
              <Input id="author" value={c.author} onChange={(e) => set("author", e.target.value)} maxLength={80} />
            </F>
            <ListField id="brand" label="Brand facts the writer may state without a source" items={c.brandLines} onChange={(v) => set("brandLines", v)} placeholder="One fact per line" rows={4} />
          </div>
        </Card>

        <Card>
          <CardTitle hint="Starts a run every day at the start time, in this timezone. The draft waits for your approval; nothing is ever published on its own.">Daily schedule</CardTitle>
          <div className="mt-4 grid gap-4">
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 text-[14px]">
              <span className="font-medium">Generate a draft every morning</span>
              <Switch on={c.schedule.enabled} onChange={(v) => set("schedule", { ...c.schedule, enabled: v })} label="Generate a draft every morning" />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <F id="start" label="Start at">
                <Input id="start" type="time" value={c.schedule.startTime} onChange={(e) => set("schedule", { ...c.schedule, startTime: e.target.value })} />
              </F>
              <F id="ready" label="Promise it by">
                <Input id="ready" type="time" value={c.schedule.readyBy} onChange={(e) => set("schedule", { ...c.schedule, readyBy: e.target.value })} />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F id="tz" label="Timezone (IANA)">
                <Input id="tz" value={c.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="Asia/Kolkata" />
              </F>
              <F id="perday" label="Drafts per day">
                <Input id="perday" type="number" inputMode="numeric" min={1} max={3} value={c.schedule.perDay} onChange={(e) => set("schedule", { ...c.schedule, perDay: Number(e.target.value) })} />
              </F>
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 text-[14px]">
              <span className="font-medium">Live web research during the research stage</span>
              <Switch on={c.webResearch} onChange={(v) => set("webResearch", v)} label="Live web research during the research stage" disabled={!web} />
            </label>
            <p className="rounded-xl border border-dashed border-border p-3 text-[12.5px] text-muted-foreground">Auto-publish: off, and not available. Every article needs Approve &amp; Publish from an admin.</p>
          </div>
        </Card>

        <Card>
          <CardTitle>Categories and limits</CardTitle>
          <div className="mt-4 grid gap-4">
            <ListField id="cats" label="Categories" items={c.categories} onChange={(v) => set("categories", v)} placeholder="One per line" rows={6} />
            <ListField id="rest" label="Restricted topics (never written about)" items={c.restrictedTopics} onChange={(v) => set("restrictedTopics", v)} placeholder="One per line" rows={5} />
          </div>
        </Card>

        <Card>
          <CardTitle hint="The writer may mention one of these only when the article's problem genuinely touches it. Links must be paths on outlly.com.">Outlly features the writer knows about</CardTitle>
          <div className="mt-4 grid gap-3">
            {c.featureRefs.map((f, i) => (
              <FeatureRow key={i} f={f} onChange={(nf) => set("featureRefs", c.featureRefs.map((x, j) => (j === i ? nf : x)))} onRemove={() => set("featureRefs", c.featureRefs.filter((_, j) => j !== i))} />
            ))}
            <Button type="button" variant="subtle" className="min-h-11 justify-self-start" onClick={() => set("featureRefs", [...c.featureRefs, { id: `feature-${c.featureRefs.length + 1}`, name: "", helpsWith: "", href: "/#features" }])}>
              Add a feature
            </Button>
          </div>
        </Card>
      </div>
    </form>
  );
}

function F({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
function ListField({ id, label, items, onChange, placeholder, rows }: { id: string; label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string; rows: number }) {
  const [text, setText] = useState(items.join("\n"));
  return (
    <F id={id} label={label}>
      <Textarea
        id={id}
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
        }}
      />
    </F>
  );
}
function FeatureRow({ f, onChange, onRemove }: { f: BlogFeatureRef; onChange: (f: BlogFeatureRef) => void; onRemove: () => void }) {
  return (
    <div className={cn("grid gap-2 rounded-2xl border border-border p-3 sm:grid-cols-[1fr_1fr_auto]")}>
      <Input aria-label="Feature name" value={f.name} onChange={(e) => onChange({ ...f, name: e.target.value, id: f.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-") })} placeholder="Feature name" maxLength={80} />
      <Input aria-label="Link path" value={f.href} onChange={(e) => onChange({ ...f, href: e.target.value })} placeholder="/#features" maxLength={120} />
      <Button type="button" variant="ghost" className="min-h-11" onClick={onRemove}>
        Remove
      </Button>
      <Input aria-label="What it helps with" value={f.helpsWith} onChange={(e) => onChange({ ...f, helpsWith: e.target.value })} placeholder="Helps with..." maxLength={300} className="sm:col-span-3" />
    </div>
  );
}
