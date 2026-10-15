"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lightbulb, MessageCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";

type Idea = { id: string; text: string; source: string; done: boolean; createdAt: string };
const SHOW = 5;

/** Idea bank: jot an idea, keep comments worth answering, turn one into a post in a click. */
export function IdeaBank() {
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
  const shown = all ? list : list.slice(0, SHOW);
  return (
    <section id="ideas" aria-labelledby={`${id}-h`} className="glass min-w-0 scroll-mt-24 rounded-[32px] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={`${id}-h`} className="eyebrow flex items-center gap-2"><Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Idea bank</h2>
        {list.length > 0 && <span className="text-sm text-muted-foreground">{list.length} saved</span>}
      </div>
      <form onSubmit={add} className="flex gap-2">
        <label htmlFor={`${id}-in`} className="sr-only">New idea</label>
        <input
          ref={input}
          id={`${id}-in`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="A video idea, a question a follower asked..."
          className="h-11 min-w-0 flex-1 rounded-2xl bg-secondary/60 px-4 text-[15px] hairline placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" variant="lime" aria-label="Save idea" disabled={busy === "add"}>
          <Plus className="h-5 w-5" aria-hidden="true" />
        </Button>
      </form>
      {ideas === null ? (
        <div className="mt-4 space-y-2" aria-hidden="true">
          <div className="skeleton h-11 rounded-2xl" />
          <div className="skeleton h-11 rounded-2xl" />
        </div>
      ) : list.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing saved yet. Ideas you jot here, and comments you save from the Inbox, wait for you.</p>
      ) : (
        <ul className="mt-3 flex flex-col" aria-label="Saved ideas">
          {shown.map((i) => (
            <li key={i.id} className="group flex min-h-[48px] items-center gap-2 border-b border-border/60 py-1 last:border-0">
              {i.source === "comment" && <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="From a comment" />}
              <span className="min-w-0 flex-1 text-[15px] leading-snug">{i.text}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove idea: ${i.text.slice(0, 40)}`} onClick={() => remove(i)} className="opacity-70 hover:opacity-100">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="subtle" onClick={() => make(i)} disabled={busy === i.id} aria-label={`Make a post from: ${i.text.slice(0, 40)}`}>
                Make it <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.length > SHOW && (
        <Button variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all} className="-ml-3 mt-2">
          {all ? "Show fewer" : `Show all ${list.length}`}
        </Button>
      )}
    </section>
  );
}
