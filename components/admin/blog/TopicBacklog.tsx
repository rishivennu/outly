"use client";
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import type { BlogBacklogTopic } from "@/lib/blog/types";
import { Card, CardTitle, Empty, Pill, fmtDate } from "../ui";

type Lists = { backlog: BlogBacklogTopic[]; candidates: BlogBacklogTopic[] };

/**
 * R1178 topic backlog. Topics an admin queues here are what the next scheduled run writes about, oldest first,
 * before the agent looks for a problem of its own. Candidates are the runners-up from earlier topic stages.
 */
export function TopicBacklog({ initial, categories }: { initial: Lists; categories?: string[] }) {
  const [lists, setLists] = useState(initial);
  const [f, setF] = useState({ topic: "", problem: "", primaryKeyword: "", category: categories?.[0] ?? "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  async function reload() {
    setLists(await adminApi<Lists>("/api/admin/blog/topics"));
  }
  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      toast(done);
      await reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.topic.trim()) return setErr("A topic is required.");
    run(
      "add",
      async () => {
        await adminApi("/api/admin/blog/topics", { method: "POST", json: { topic: f.topic.trim(), problem: f.problem.trim(), primaryKeyword: f.primaryKeyword.trim(), category: f.category.trim() } });
        setF((x) => ({ ...x, topic: "", problem: "", primaryKeyword: "" }));
      },
      "Added to the backlog",
    );
  };

  return (
    <Card>
      <CardTitle hint="The next scheduled run writes about the first topic in the backlog. With an empty backlog the agent finds a creator problem itself.">Topic backlog</CardTitle>
      {err && (
        <p role="alert" className="mb-3 text-[13.5px] text-destructive">
          {err}
        </p>
      )}
      {lists.backlog.length ? (
        <ol className="grid gap-2">
          {lists.backlog.map((t, i) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                  {i === 0 && <Pill tone="lime">Next run</Pill>}
                  {t.topic}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{[t.category, t.primaryKeyword, t.problem, `added ${fmtDate(t.createdAt)}`].filter(Boolean).join(" · ")}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy !== null} aria-label={`Remove ${t.topic}`} onClick={() => run(`rm-${t.id}`, () => adminApi(`/api/admin/blog/topics?id=${encodeURIComponent(t.id)}`, { method: "DELETE" }), "Removed from the backlog")}>
                {busy === `rm-${t.id}` ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Remove
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="The backlog is empty" body="Add a topic below or pick one of the candidates, and the next scheduled run writes it." />
      )}

      <form onSubmit={add} className="mt-5 grid gap-3 rounded-2xl bg-secondary/60 p-4 sm:grid-cols-2">
        <p className="text-[13.5px] font-semibold sm:col-span-2">Add a topic</p>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="tb-topic">Topic (required)</Label>
          <Input id="tb-topic" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} required maxLength={200} placeholder="e.g. Why reels stop getting reach after a viral post" />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="tb-problem">Creator problem</Label>
          <Input id="tb-problem" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} maxLength={400} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tb-kw">Primary keyword</Label>
          <Input id="tb-kw" value={f.primaryKeyword} onChange={(e) => setF({ ...f, primaryKeyword: e.target.value })} maxLength={80} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tb-cat">Category</Label>
          {categories?.length ? (
            <select id="tb-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="field min-h-11 rounded-xl border border-border bg-card px-3 text-[14px]">
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <Input id="tb-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={60} />
          )}
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={busy !== null || !f.topic.trim()} className="min-h-11">
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Add to backlog
          </Button>
        </div>
      </form>

      <div className="mt-6">
        <p className="text-[13.5px] font-semibold">Candidates from earlier runs</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Problems the agent scored but did not pick. Topics already written are left out.</p>
        {lists.candidates.length ? (
          <ul className="mt-3 grid gap-2">
            {lists.candidates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{t.topic}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{[`score ${t.score}`, t.category, t.primaryKeyword].filter(Boolean).join(" · ")}</p>
                </div>
                <Button type="button" variant="subtle" size="sm" className="min-h-11" disabled={busy !== null} onClick={() => run(`mv-${t.id}`, () => adminApi("/api/admin/blog/topics", { method: "POST", json: { fromId: t.id } }), "Moved to the backlog")}>
                  {busy === `mv-${t.id}` ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Add to backlog
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13.5px] text-muted-foreground">No candidates yet. Each run's topic stage leaves its runners-up here.</p>
        )}
      </div>
    </Card>
  );
}
