"use client";
import { useEffect, useState } from "react";
import { Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { BRAND_LIMITS, type ObjectiveOption } from "@/lib/intelligence/brand-core";
import { cn } from "@/lib/utils";

type Objective = ObjectiveOption["id"];
type Profile = { objective: Objective; name: string | null; audience: string | null; pillars: string[]; tone: string | null; avoid: string[] };
type Loaded = { profile: Profile | null; objectives: ObjectiveOption[] };

/**
 * R1235: the brand profile of this workspace. The objective decides which metrics Outlly Intelligence judges a post
 * by, so each option carries the engine's own reason (lib/intelligence/core.ts OBJECTIVE_METRICS) and the three that
 * no platform reports say so in plain words instead of pretending to measure clicks or sales.
 */
function Chips({ id, label, hint, values, placeholder, disabled, onChange }: { id: string; label: string; hint: string; values: string[]; placeholder: string; disabled: boolean; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const full = values.length >= BRAND_LIMITS.listItems;
  const add = () => {
    const v = draft.trim().slice(0, BRAND_LIMITS.listItem);
    if (!v || full || values.includes(v)) return setDraft("");
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        <span className="tabular text-xs text-muted-foreground">{values.length}/{BRAND_LIMITS.listItems}</span>
      </Label>
      <Input
        id={id}
        value={draft}
        disabled={disabled || full}
        maxLength={BRAND_LIMITS.listItem}
        placeholder={full ? `That's all ${BRAND_LIMITS.listItems}` : placeholder}
        aria-describedby={`${id}-h`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <p id={`${id}-h`} className="mt-1.5 text-[13px] text-muted-foreground">{hint} Press Enter to add.</p>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v}>
              <span className="inline-flex min-h-11 items-center gap-1 rounded-full bg-secondary/60 pl-4 pr-1 text-sm hairline">
                <span className="truncate">{v}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BrandProfileCard() {
  const [d, setD] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [objective, setObjective] = useState<Objective>("engagement");
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [pillars, setPillars] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api<Loaded>("/api/settings/brand").then(
      (r) => {
        setD(r);
        if (r.profile) {
          setObjective(r.profile.objective);
          setName(r.profile.name ?? "");
          setAudience(r.profile.audience ?? "");
          setTone(r.profile.tone ?? "");
          setPillars(r.profile.pillars);
          setAvoid(r.profile.avoid);
        }
      },
      () => setFailed(true),
    );
  }, []);

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      const r = await api<{ profile: Profile }>("/api/settings/brand", {
        method: "POST",
        json: { objective, name: name.trim() || null, audience: audience.trim() || null, tone: tone.trim() || null, pillars, avoid },
      });
      setD((prev) => (prev ? { ...prev, profile: r.profile } : prev));
      setNote({ kind: "ok", text: "Saved. Outlly Intelligence will judge new posts by this." });
    } catch (err) {
      setNote({ kind: "error", text: err instanceof ApiError ? err.message : "Something got in the way." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass flex h-full flex-col rounded-[32px] p-6 sm:p-8" aria-labelledby="bp-h">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true">
          <Target className="h-5 w-5" />
        </span>
        <div>
          <h2 id="bp-h" className="text-2xl font-semibold tracking-tight">Brand</h2>
          <p className="mt-1 text-sm text-muted-foreground">What you are growing and who it is for. Outlly reads this before it tells you what is working.</p>
        </div>
      </div>

      {failed && <p className="mt-4 text-sm text-destructive">That didn&apos;t load. Refresh the page and try again.</p>}

      {d && (
        <div className="mt-6 grid gap-6">
          <div>
            <Label htmlFor="bp-name">
              Brand name
              <Counter value={name.length} max={BRAND_LIMITS.name} />
            </Label>
            <Input id="bp-name" value={name} maxLength={BRAND_LIMITS.name} disabled={saving} placeholder="Outlly" onChange={(e) => setName(e.target.value)} />
          </div>

          <fieldset disabled={saving}>
            <legend className="text-[15px] font-medium">What are you growing right now?</legend>
            <p className="mt-1 text-[13px] text-muted-foreground">One objective. It decides which numbers count when Outlly compares your posts.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {d.objectives.map((o) => (
                <label
                  key={o.id}
                  className={cn(
                    "flex min-h-11 cursor-pointer gap-3 rounded-2xl p-3 text-sm hairline transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                    objective === o.id ? "bg-lime text-[hsl(var(--lime-foreground))]" : "hover:bg-secondary/60",
                  )}
                >
                  <input type="radio" name="bp-objective" value={o.id} checked={objective === o.id} onChange={() => setObjective(o.id)} className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--lime))]" />
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {o.label}
                      {objective === o.id && <span className="sr-only"> (chosen)</span>}
                    </span>
                    <span className={cn("mt-0.5 block text-[13px]", objective === o.id ? "text-[hsl(var(--lime-foreground))]/80" : "text-muted-foreground")}>{o.reason}</span>
                    {o.proxy && (
                      <span className={cn("mt-1 block text-[13px] font-medium", objective === o.id ? "text-[hsl(var(--lime-foreground))]" : "text-warning-ink")}>
                        Measured by a proxy: no platform gives Outlly clicks or sales, so these stand in for it.
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <Label htmlFor="bp-audience">
              Who it is for
              <Counter value={audience.length} max={BRAND_LIMITS.audience} />
            </Label>
            <Textarea id="bp-audience" rows={3} value={audience} maxLength={BRAND_LIMITS.audience} disabled={saving} placeholder="Solo creators in India who post every day and sell their own courses." onChange={(e) => setAudience(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="bp-tone">
              How you sound
              <Counter value={tone.length} max={BRAND_LIMITS.tone} />
            </Label>
            <Input id="bp-tone" value={tone} maxLength={BRAND_LIMITS.tone} disabled={saving} placeholder="Plain, warm, a little blunt" onChange={(e) => setTone(e.target.value)} />
          </div>

          <Chips id="bp-pillars" label="Content pillars" hint="The few things you post about." values={pillars} placeholder="Behind the scenes" disabled={saving} onChange={setPillars} />
          <Chips id="bp-avoid" label="Things to avoid" hint="Outlly will not suggest these." values={avoid} placeholder="Politics" disabled={saving} onChange={setAvoid} />

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="lime" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save brand"}
            </Button>
            {note && (
              <p role="status" className={cn("text-sm", note.kind === "ok" ? "text-foreground" : "text-destructive")}>
                {note.kind === "error" && <span className="font-medium">Not saved. </span>}
                {note.text}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
