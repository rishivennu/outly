"use client";
import { useEffect, useId, useState } from "react";
import { BookmarkPlus, ChevronDown, Hash, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export type Snippet = { id: string; kind: "caption" | "hashtags" | "template" | "brand"; name: string; body: string; uses: number };

// One fetch per page, shared by every platform tab.
let cache: Promise<Snippet[]> | null = null;
const loadSnippets = (fresh = false) => {
  if (!cache || fresh) cache = api<{ snippets: Snippet[] }>("/api/snippets").then((r) => r.snippets).catch(() => []);
  return cache;
};

/**
 * Saved caption presets and hashtag sets, right under the copy fields. Insert appends a caption
 * preset (sign-off, call to action) and merges a hashtag set without duplicates.
 */
export function SnippetBar({ caption, hashtags, showTags, onCaption, onTags }: { caption: string; hashtags: string; showTags: boolean; onCaption: (v: string) => void; onTags: (v: string) => void }) {
  const toast = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Snippet[] | null>(null);
  const [saving, setSaving] = useState<null | "caption" | "hashtags">(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (open && !list) void loadSnippets().then(setList);
  }, [open, list]);

  function insert(s: Snippet) {
    if (s.kind === "hashtags") {
      const have = new Set(hashtags.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase()));
      const add = s.body.split(/\s+/).filter((t) => t && !have.has(t.toLowerCase()));
      onTags([hashtags.trim(), ...add].filter(Boolean).join(" "));
    } else onCaption(caption.trim() ? `${caption.trimEnd()}\n\n${s.body}` : s.body);
    toast(`Added "${s.name}"`, "ok");
    void api(`/api/snippets/${s.id}`, { method: "PATCH", json: { used: true } }).catch(() => {});
  }

  async function save(kind: "caption" | "hashtags") {
    const body = (kind === "caption" ? caption : hashtags).trim();
    if (!body) return toast(kind === "caption" ? "Write a caption first" : "Add some hashtags first", "info");
    try {
      const r = await api<{ snippet: Snippet }>("/api/snippets", { method: "POST", json: { kind, name: name.trim() || (kind === "caption" ? body.split("\n")[0].slice(0, 40) : body.split(/\s+/).slice(0, 3).join(" ")), body } });
      setList((x) => [r.snippet, ...(x ?? [])]);
      cache = Promise.resolve([r.snippet, ...((await cache) ?? [])]);
      setSaving(null);
      setName("");
      toast("Saved for next time", "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save it", "error");
    }
  }

  const usable = (list ?? []).filter((s) => s.kind === "caption" || s.kind === "template" || (showTags && s.kind === "hashtags"));
  return (
    <div className="rounded-2xl bg-secondary/40 hairline">
      <button type="button" aria-expanded={open} aria-controls={`${id}-p`} onClick={() => setOpen((v) => !v)} className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-sm font-medium">
        <span className="flex items-center gap-2"><BookmarkPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Saved snippets</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div id={`${id}-p`} className="space-y-3 px-4 pb-4">
          {list === null ? (
            <p className="text-sm text-muted-foreground">Loading</p>
          ) : usable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing saved yet. Save a sign-off you always use, or a hashtag set, and add it in one click next time.</p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Insert a snippet">
              {usable.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => insert(s)} title={s.body} className="inline-flex min-h-[44px] max-w-[240px] items-center gap-1.5 rounded-full bg-background/70 px-3.5 text-[13px] font-medium hairline hover:bg-background">
                    {s.kind === "hashtags" ? <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Quote className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{s.name}</span>
                    <span className="sr-only">, {s.kind === "hashtags" ? "hashtag set" : "caption preset"}. Add it.</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {saving ? (
            <form onSubmit={(e) => { e.preventDefault(); void save(saving); }} className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-n`} className="sr-only">Snippet name</label>
              <input id={`${id}-n`} autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={saving === "caption" ? "Name, e.g. Sign-off" : "Name, e.g. Baking tags"} className="h-11 min-w-0 flex-1 rounded-2xl bg-background/70 px-3 text-sm hairline" />
              <Button type="submit" variant="lime">Save</Button>
              <Button type="button" variant="ghost" onClick={() => setSaving(null)}>Cancel</Button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => setSaving("caption")} className="-ml-2">Save this caption</Button>
              {showTags && <Button type="button" variant="ghost" onClick={() => setSaving("hashtags")}>Save these hashtags</Button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { loadSnippets };
