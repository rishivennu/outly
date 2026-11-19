"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Sparkles, Tags, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { PostTags } from "@/lib/intelligence/categories";

// R1237: kept in step with lib/intelligence/categories-core.ts (a client file can't import the server module's values).
const TOPIC_MAX = 60;
const NAME_MAX = 40;
const TAGS_MAX = 5;

type State = "idle" | "saving" | "saved" | "error";
const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const chip = cn("inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] hairline transition-colors duration-200", ring);

/**
 * R1237: the post's topic and content categories, in the post sheet. Chips toggle the owner's categories (up to 5),
 * the topic saves on blur or Enter, and "Suggested" applies the deterministic keyword match. No AI.
 */
export function TagsControl({ postId }: { postId: string }) {
  const [data, setData] = useState<PostTags | null>(null);
  const [topic, setTopicText] = useState("");
  const [newName, setNewName] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<string>("");

  useEffect(() => {
    let alive = true;
    setData(null);
    api<PostTags>(`/api/posts/${postId}/tags`).then(
      (r) => {
        if (!alive) return;
        setData(r);
        setTopicText(r.topic ?? "");
        saved.current = r.topic ?? "";
      },
      (e) => alive && setError(e instanceof ApiError ? e.message : "Couldn't load the tags."),
    );
    return () => {
      alive = false;
    };
  }, [postId]);

  const put = async (json: { categoryIds?: string[]; topic?: string | null }) => {
    setState("saving");
    setError(null);
    try {
      const r = await api<PostTags>(`/api/posts/${postId}/tags`, { method: "PUT", json });
      setData(r);
      saved.current = r.topic ?? "";
      if (json.topic !== undefined) setTopicText(r.topic ?? "");
      setState("saved");
    } catch (e) {
      setState("error");
      setError(e instanceof ApiError ? e.message : "Couldn't save that. Try again.");
    }
  };

  const ids = data?.categories.map((c) => c.id) ?? [];
  const toggle = (id: string) => void put({ categoryIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  const saveTopic = () => {
    if (topic.trim() === saved.current.trim()) return;
    void put({ topic: topic.trim() || null });
  };
  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || ids.length >= TAGS_MAX) return;
    setState("saving");
    setError(null);
    try {
      const r = await api<{ category: { id: string } }>("/api/content/categories", { method: "POST", json: { name } });
      setNewName("");
      await put({ categoryIds: [...ids, r.category.id] });
    } catch (err) {
      setState("error");
      setError(err instanceof ApiError ? err.message : "Couldn't add that category.");
    }
  };

  const full = ids.length >= TAGS_MAX;
  const busy = state === "saving";
  const h = `tags-${postId}`;

  return (
    <section aria-labelledby={h} className="rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="flex items-center justify-between gap-2">
        <h3 id={h} className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="h-4 w-4" aria-hidden="true" /> Topic and tags
        </h3>
        <p className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving
            </>
          ) : state === "saved" ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Saved
            </>
          ) : null}
        </p>
      </div>

      {!data ? (
        error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">Loading tags…</p>
        )
      ) : (
        <>
          <label htmlFor={`${h}-topic`} className="mt-3 block text-xs font-medium text-muted-foreground">Topic</label>
          <input
            id={`${h}-topic`}
            value={topic}
            maxLength={TOPIC_MAX}
            onChange={(e) => setTopicText(e.target.value)}
            onBlur={saveTopic}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveTopic();
              }
            }}
            placeholder="What is this post about?"
            className={cn("mt-1 h-11 w-full rounded-xl bg-background/70 px-3 text-sm hairline", ring)}
          />

          <p id={`${h}-cats`} className="mt-3 text-xs font-medium text-muted-foreground">
            Categories <span className="font-normal">({ids.length} of {TAGS_MAX})</span>
          </p>
          {data.available.length ? (
            <ul className="mt-1.5 flex flex-wrap gap-2" aria-labelledby={`${h}-cats`}>
              {data.available.map((c) => {
                const on = ids.includes(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={busy || (!on && full)}
                      onClick={() => toggle(c.id)}
                      className={cn(chip, on ? "bg-[hsl(var(--lime)/0.18)] font-semibold ring-2 ring-[hsl(var(--lime))]" : "bg-background/60 hover:bg-secondary/70", "disabled:opacity-60")}
                    >
                      {on && <X className="h-3.5 w-3.5" aria-hidden="true" />}
                      {c.name}
                      {on && <span className="sr-only">, remove</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">No categories yet. Add your first one below.</p>
          )}

          {data.suggestion && !full && (
            <button type="button" disabled={busy} onClick={() => toggle(data.suggestion!.id)} className={cn(chip, "mt-2 bg-background/60 hover:bg-secondary/70")}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Suggested: {data.suggestion.name}
            </button>
          )}

          {!full && (
            <form onSubmit={addCategory} className="mt-3 flex gap-2">
              <label htmlFor={`${h}-new`} className="sr-only">New category</label>
              <input id={`${h}-new`} value={newName} maxLength={NAME_MAX} onChange={(e) => setNewName(e.target.value)} placeholder="New category" className={cn("h-11 min-w-0 flex-1 rounded-xl bg-background/70 px-3 text-sm hairline", ring)} />
              <button type="submit" disabled={busy || !newName.trim()} className={cn(chip, "bg-secondary hover:bg-secondary/70 disabled:opacity-60")}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Add
              </button>
            </form>
          )}

          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        </>
      )}
    </section>
  );
}
