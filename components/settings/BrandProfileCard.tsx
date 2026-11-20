"use client";
import { useEffect, useState } from "react";
import { Plus, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { useUser } from "@/components/shell/UserContext";
import { platformLabel } from "@/components/intelligence/view-core";
import { BRAND_LIMITS, type ObjectiveOption } from "@/lib/intelligence/brand-core";
import { cn } from "@/lib/utils";

type Objective = ObjectiveOption["id"];
type Profile = { objective: Objective; name: string | null; audience: string | null; pillars: string[]; tone: string | null; avoid: string[] };
type Account = { id: string; platform: string; username: string; displayName: string | null };
type Loaded = { profile: Profile | null; objectives: ObjectiveOption[]; accounts?: Account[]; limits?: { clients?: number } };
type ClientRow = { scopeKey: string; name: string | null; objective: Objective; accountIds: string[] };
type Draft = { scopeKey: string | null; name: string; objective: Objective; accountIds: string[] };

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

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * R1246: agency clients. Each client is a brand profile with its own objective and the owner's accounts it covers, so
 * Content Intelligence can show that client's numbers on their own. Owner only: the routes under /api/settings are too.
 */
function ClientsSection({ objectives, accounts, max }: { objectives: ObjectiveOption[]; accounts: Account[]; max: number }) {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = () =>
    api<{ profiles: ClientRow[] }>("/api/settings/brand/profiles").then(
      (r) => setRows(r.profiles.filter((p) => p.scopeKey !== "")),
      () => setFailed(true),
    );
  useEffect(() => {
    void load();
  }, []);

  const objectiveLabel = (id: string) => objectives.find((o) => o.id === id)?.label ?? id;
  const fail = (err: unknown) => setNote({ kind: "error", text: err instanceof ApiError ? err.message : "Something got in the way." });

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setNote(null);
    try {
      const fields = { objective: draft.objective, name: draft.name.trim(), accountIds: draft.accountIds };
      if (draft.scopeKey) {
        // The form edits name, objective and accounts; the rest of the profile is sent back as it was.
        const cur = await api<{ profile: Profile | null }>(`/api/settings/brand?scope=${encodeURIComponent(draft.scopeKey)}`);
        const keep = cur.profile ? { audience: cur.profile.audience, tone: cur.profile.tone, pillars: cur.profile.pillars, avoid: cur.profile.avoid } : {};
        await api(`/api/settings/brand?scope=${encodeURIComponent(draft.scopeKey)}`, { method: "POST", json: { ...keep, ...fields } });
      } else {
        await api("/api/settings/brand", { method: "POST", json: { ...fields, client: true } });
      }
      setNote({ kind: "ok", text: `Saved ${draft.name.trim()}.` });
      setDraft(null);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: string) => {
    setBusy(true);
    setNote(null);
    try {
      await api(`/api/settings/brand?scope=${encodeURIComponent(key)}`, { method: "DELETE" });
      setConfirm(null);
      setNote({ kind: "ok", text: "Client removed." });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const full = !!rows && rows.length >= max;
  const toggle = (id: string) => setDraft((d) => (d ? { ...d, accountIds: d.accountIds.includes(id) ? d.accountIds.filter((x) => x !== id) : [...d.accountIds, id] } : d));

  return (
    <section className="grid gap-4 border-t border-border/60 pt-6" aria-labelledby="bp-clients-h">
      <div>
        <h3 id="bp-clients-h" className="text-lg font-semibold tracking-tight">Clients</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">For agencies. Give each client its accounts, and Content Intelligence shows that client&apos;s numbers on their own.</p>
      </div>

      {failed && <p className="text-sm text-destructive">Your clients didn&apos;t load. Refresh the page and try again.</p>}
      {rows && rows.length === 0 && !draft && <p className="text-sm text-muted-foreground">No clients yet. Add one to see its numbers on their own.</p>}

      {rows && rows.length > 0 && (
        <ul className="grid gap-2">
          {rows.map((c) => {
            const label = c.name?.trim() || c.scopeKey;
            return (
              <li key={c.scopeKey} className="rounded-2xl p-3 hairline">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{label}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {objectiveLabel(c.objective)} · {c.accountIds.length ? plural(c.accountIds.length, "account") : "No accounts yet"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy} className={FOCUS} onClick={() => { setConfirm(null); setDraft({ scopeKey: c.scopeKey, name: label, objective: c.objective, accountIds: c.accountIds }); }}>
                    Edit<span className="sr-only"> {label}</span>
                  </Button>
                  <Button variant="danger" size="sm" disabled={busy} className={FOCUS} onClick={() => setConfirm(c.scopeKey)}>
                    Remove<span className="sr-only"> {label}</span>
                  </Button>
                </div>
                {confirm === c.scopeKey && (
                  <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    <span>Remove {label}? Its posts and accounts stay; only the client profile goes.</span>
                    <Button variant="danger" size="sm" disabled={busy} className={FOCUS} onClick={() => remove(c.scopeKey)}>
                      {busy ? "Removing..." : "Yes, remove"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} className={FOCUS} onClick={() => setConfirm(null)}>
                      Keep
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {draft ? (
        <fieldset disabled={busy} className="grid gap-4 rounded-2xl p-4 hairline">
          <legend className="px-1 text-[15px] font-medium">{draft.scopeKey ? "Edit client" : "Add a client"}</legend>
          <div>
            <Label htmlFor="bp-client-name">
              Client name
              <Counter value={draft.name.length} max={BRAND_LIMITS.name} />
            </Label>
            <Input id="bp-client-name" value={draft.name} maxLength={BRAND_LIMITS.name} placeholder="Zeta Foods" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="bp-client-objective" className="text-sm font-medium">What this client is growing</label>
            <select id="bp-client-objective" value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value as Objective })} className={cn("h-11 w-full max-w-xs rounded-2xl bg-secondary/50 px-3 text-[14px] hairline", FOCUS)}>
              {objectives.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Its accounts</legend>
            {accounts.length === 0 ? (
              <p className="mt-1 text-[13px] text-muted-foreground">You have no connected accounts yet. Connect one under Accounts, then give it to this client.</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {accounts.map((a) => (
                  <label key={a.id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-sm hairline transition-colors hover:bg-secondary/60 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2")}>
                    <input type="checkbox" checked={draft.accountIds.includes(a.id)} onChange={() => toggle(a.id)} className="h-5 w-5 shrink-0 accent-[hsl(var(--lime))]" />
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{platformLabel(a.platform)}</span> @{a.username}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button variant="lime" disabled={busy || !draft.name.trim()} onClick={save}>
              {busy ? "Saving..." : draft.scopeKey ? "Save client" : "Add client"}
            </Button>
            <Button variant="ghost" disabled={busy} className={FOCUS} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : (
        rows && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={busy || full} className={FOCUS} onClick={() => { setConfirm(null); setNote(null); setDraft({ scopeKey: null, name: "", objective: "engagement", accountIds: [] }); }}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add client
            </Button>
            {full && <p className="text-[13px] text-muted-foreground">That is all {max} clients. Remove one to add another.</p>}
          </div>
        )
      )}

      {note && (
        <p role="status" className={cn("text-sm", note.kind === "ok" ? "text-foreground" : "text-destructive")}>
          {note.kind === "error" && <span className="font-medium">Not saved. </span>}
          {note.text}
        </p>
      )}
    </section>
  );
}

export function BrandProfileCard() {
  const { workspace } = useUser();
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

          {!workspace && <ClientsSection objectives={d.objectives} accounts={d.accounts ?? []} max={d.limits?.clients ?? 20} />}
        </div>
      )}
    </section>
  );
}
