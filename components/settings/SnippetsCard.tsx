"use client";
import { useEffect, useId, useState } from "react";
import { BookmarkPlus, Hash, Quote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Snippet = { id: string; kind: "caption" | "hashtags" | "template" | "brand"; name: string; body: string; uses: number };
const KINDS = [
  { id: "caption", label: "Caption preset", hint: "A sign-off or call to action you add to most posts." },
  { id: "hashtags", label: "Hashtag set", hint: "Tags that travel together, added without duplicates." },
  { id: "brand", label: "Brand notes", hint: "How you sound and words you avoid. Kept for your team." },
] as const;

/** Starters for an empty list: one tap fills the form, the user edits and saves. */
const EXAMPLES = [
  { kind: "caption", name: "Sign-off", body: "Thanks for watching. Follow for a new one every week." },
  { kind: "hashtags", name: "Core tags", body: "#behindthescenes #smallbusiness #creatorlife" },
  { kind: "brand", name: "Our voice", body: "Warm and short. Say you, not users. No slang we would not say out loud." },
] as const;

/** Manage the snippets the composer offers: add, read, delete. */
export function SnippetsCard() {
  const toast = useToast();
  const id = useId();
  const [list, setList] = useState<Snippet[] | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("caption");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ snippets: Snippet[] }>("/api/snippets").then((r) => setList(r.snippets)).catch(() => setList([]));
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ snippet: Snippet }>("/api/snippets", { method: "POST", json: { kind, name, body } });
      setList((x) => [r.snippet, ...(x ?? [])]);
      setName("");
      setBody("");
      toast("Snippet saved", "ok");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save it", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Snippet) {
    setList((x) => x?.filter((y) => y.id !== s.id) ?? null);
    try {
      await api(`/api/snippets/${s.id}`, { method: "DELETE" });
    } catch {
      setList((x) => [s, ...(x ?? [])]);
      toast("Couldn't delete it", "error");
    }
  }

  return (
    <section className="glass rounded-[32px] p-6" aria-labelledby={`${id}-h`}>
      <div className="mb-4 flex items-start gap-3">
        <BookmarkPlus className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 id={`${id}-h`} className="text-lg font-semibold">Snippets</h2>
          <p className="text-sm text-muted-foreground">Save the bits you type every time. They show up under every caption in Create.</p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={add} className="space-y-3">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Type</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <label key={k.id} className={cn("inline-flex min-h-[44px] cursor-pointer items-center rounded-full px-4 text-sm hairline has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", kind === k.id ? "bg-foreground text-background" : "bg-secondary/60")}>
                  <input type="radio" name={`${id}-kind`} value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} className="sr-only" />
                  {k.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">{KINDS.find((k) => k.id === kind)!.hint}</p>
          </fieldset>
          <div>
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input id={`${id}-name`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={kind === "hashtags" ? "Baking tags" : "Sign-off"} required />
          </div>
          <div>
            <Label htmlFor={`${id}-body`}>{kind === "hashtags" ? "Hashtags" : "Text"}</Label>
            <Textarea id={`${id}-body`} rows={3} value={body} maxLength={2200} onChange={(e) => setBody(e.target.value)} placeholder={kind === "hashtags" ? "#sourdough #homebaker #breadtok" : "New recipe every Tuesday. Follow so you don't miss it."} required />
          </div>
          <Button type="submit" variant="lime" disabled={busy || !name.trim() || !body.trim()}>Save snippet</Button>
        </form>
        <div className="flex min-w-0 flex-col">
          <h3 className="mb-2 text-sm font-medium">Saved</h3>
          {list === null ? (
            <div className="skeleton h-24 rounded-2xl" aria-hidden="true" />
          ) : list.length === 0 ? (
            <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border p-5 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true">
                <BookmarkPlus className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="text-[15px] font-medium">Nothing saved yet</p>
              <p className="max-w-xs text-[13px] text-muted-foreground">Start from an example. Tap one to fill the form, change it, then save.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.name}
                    type="button"
                    onClick={() => {
                      setKind(ex.kind);
                      setName(ex.name);
                      setBody(ex.body);
                      document.getElementById(`${id}-body`)?.focus();
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-secondary/60 px-4 text-sm hairline transition-colors hover:bg-secondary focus-visible:outline-2"
                  >
                    {ex.kind === "hashtags" ? <Hash className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <Quote className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    <span><span className="sr-only">Use example </span>{ex.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="flex max-h-[340px] flex-col overflow-y-auto" data-lenis-prevent>
              {list.map((s) => (
                <li key={s.id} className="flex items-start gap-2 border-b border-border/60 py-2 last:border-0">
                  {s.kind === "hashtags" ? <Hash className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Quote className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{s.name}</p>
                    <p className="line-clamp-2 text-[13px] text-muted-foreground">{s.body}</p>
                    {s.uses > 0 && <p className="text-[12px] text-muted-foreground">Used {s.uses} time{s.uses === 1 ? "" : "s"}</p>}
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Delete snippet ${s.name}`} onClick={() => remove(s)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
