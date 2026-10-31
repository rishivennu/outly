"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lightbulb, MessageCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pip } from "@/components/brand/Pip";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";

type Idea = { id: string; text: string; source: string; done: boolean; createdAt: string };
/** Note tints, cycled. Text on them stays foreground (see .idea-note). */
const NOTE = ["#9be22a", "#6c5cff", "#ffb13d", "#ff5fb8", "#3ee0ff"];
const STARTERS = ["A question a follower asked", "Behind the scenes of my week", "A mistake I learned from"];

/** Ideas (10-15 redesign): a pill to jot one, saved ideas as tinted notes, one click turns a note into a post. */
export function IdeaBank({ wide = false }: { wide?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [text, setText] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ ideas: Idea[] }>("/api/ideas").then((r) => setIdeas(r.ideas)).catch(() => setIdeas([]));
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t.length < 2) return input.current?.focus();
    setBusy("add");
    try {
      const r = await api<{ idea: Idea }>("/api/ideas", { method: "POST", json: { text: t } });
      setIdeas((x) => [r.idea, ...(x ?? [])]);
      setText("");
      input.current?.focus();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save that idea", "error");
    } finally {
      setBusy(null);
    }
  }

  async function make(i: Idea) {
    setBusy(i.id);
    try {
      await api(`/api/ideas/${i.id}`, { method: "PATCH", json: { done: true } });
      router.push(`/create?idea=${i.id}`);
    } catch {
      setBusy(null);
      toast("Couldn't open that idea", "error");
    }
  }

  async function remove(i: Idea) {
    setIdeas((x) => x?.filter((y) => y.id !== i.id) ?? null);
    try {
      await api(`/api/ideas/${i.id}`, { method: "DELETE" });
      toast("Idea removed", "ok");
    } catch {
      setIdeas((x) => (x ? [i, ...x] : [i]));
      toast("Couldn't remove it", "error");
    }
  }

  const list = ideas ?? [];
  const limit = wide ? 6 : 4; // full rows of notes
  const shown = all ? list : list.slice(0, limit);
  return (
    <section id="ideas" aria-labelledby={`${id}-h`} className="glass flex h-full min-w-0 scroll-mt-24 flex-col rounded-[32px] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={`${id}-h`} className="eyebrow flex items-center gap-2"><Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Ideas</h2>
        {list.length > 0 && <span className="text-[13px] text-muted-foreground tabular">{list.length} saved</span>}
      </div>
      <form onSubmit={add} className="fw-ring flex items-center gap-2 rounded-full bg-secondary/60 p-1.5 pl-4 hairline">
        <label htmlFor={`${id}-in`} className="sr-only">New idea</label>
        <input
          ref={input}
          id={`${id}-in`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Jot a video idea or a question a follower asked"
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" variant="lime" disabled={busy === "add"} className="shrink-0 rounded-full">
          <Plus className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Save</span><span className="sr-only sm:hidden">Save idea</span>
        </Button>
      </form>
      {ideas === null ? (
        <div className={cn("mt-4 grid gap-2", wide ? "sm:grid-cols-3" : "sm:grid-cols-2")} aria-hidden="true">
          <div className="skeleton h-28 rounded-2xl" />
          <div className="skeleton h-28 rounded-2xl" />
        </div>
      ) : list.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border p-5 text-center">
          <Pip size={56} mood="think" />
          <p className="max-w-xs text-sm text-muted-foreground">Ideas you jot here, and comments you save from the Inbox, wait for you. Need a nudge?</p>
          <div className="flex flex-wrap justify-center gap-2">
            {STARTERS.map((t) => (
              <button key={t} type="button" onClick={() => { setText(t); input.current?.focus(); }} className="inline-flex min-h-[44px] items-center rounded-full bg-secondary/60 px-4 text-sm hairline transition-colors hover:bg-secondary focus-visible:outline-2">
                {t}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ul className={cn("mt-4 grid gap-2", wide ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")} aria-label="Saved ideas">
          {shown.map((i, n) => (
            <li key={i.id} className="idea-note flex min-h-[124px] flex-col rounded-2xl p-3.5" style={{ ["--note" as string]: NOTE[n % NOTE.length] }}>
              <p className="line-clamp-3 flex-1 text-[15px] leading-snug">{i.text}</p>
              <div className="mt-3 flex items-center gap-1">
                <span className="mr-auto inline-flex min-w-0 items-center gap-1 truncate text-[12px] text-muted-foreground">
                  {i.source === "comment" ? <><MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> From a comment</> : "Your note"}
                </span>
                <Button variant="ghost" size="icon" aria-label={`Remove idea: ${i.text.slice(0, 40)}`} onClick={() => remove(i)} className="shrink-0 opacity-70 hover:opacity-100">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="subtle" onClick={() => make(i)} disabled={busy === i.id} aria-label={`Make a post from: ${i.text.slice(0, 40)}`} className="shrink-0">
                  Make it <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length > limit && (
        <Button variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all} className="-ml-3 mt-2 self-start">
          {all ? "Show fewer" : `Show all ${list.length}`}
        </Button>
      )}
    </section>
  );
}
