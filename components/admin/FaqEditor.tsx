"use client";
import { useMemo, useState } from "react";
import { ChevronDown, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Answer } from "@/components/support/Answer";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, Pill } from "./ui";
import { SearchInput } from "./SearchInput";

type F = { id: string; category: string; question: string; answer: string; published: boolean; sortOrder: number };
const NEW = (c: string): F => ({ id: "", category: c, question: "", answer: "", published: true, sortOrder: 50 });

function Form({ item, categories, onSaved, onCancel, onDelete }: { item: F; categories: string[]; onSaved: (f: F) => void; onCancel?: () => void; onDelete?: () => void }) {
  const [d, setD] = useState(item);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const toast = useToast();
  const dirty = JSON.stringify(d) !== JSON.stringify(item);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { category: d.category, question: d.question, answer: d.answer, published: d.published, sortOrder: d.sortOrder };
      const r = item.id ? await adminApi<{ item: F }>(`/api/admin/faq/${item.id}`, { method: "PATCH", json: body }) : await adminApi<{ item: F }>("/api/admin/faq", { method: "POST", json: body });
      onSaved(r.item);
      toast(item.id ? "Answer updated" : "Question added");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-3 pt-1">
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div>
          <Label htmlFor={`fq-c-${item.id}`}>Category</Label>
          <select id={`fq-c-${item.id}`} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} className="h-12 w-full rounded-2xl bg-secondary/60 px-3 text-[14px] hairline">
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`fq-q-${item.id}`}>Question</Label>
          <Input id={`fq-q-${item.id}`} value={d.question} onChange={(e) => setD({ ...d, question: e.target.value })} maxLength={200} />
        </div>
      </div>
      <div>
        <Label htmlFor={`fq-a-${item.id}`}>
          Answer
          <button type="button" onClick={() => setPreview((p) => !p)} className="text-[12px] font-semibold text-foreground underline underline-offset-4">{preview ? "Edit" : "Preview"}</button>
        </Label>
        {preview ? (
          <div className="min-h-[120px] rounded-2xl bg-secondary/30 px-4 py-3 text-[14.5px] leading-relaxed text-muted-foreground hairline"><Answer text={d.answer || "Nothing yet."} /></div>
        ) : (
          <Textarea id={`fq-a-${item.id}`} rows={5} value={d.answer} onChange={(e) => setD({ ...d, answer: e.target.value })} maxLength={2000} />
        )}
        <p className="mt-1.5 text-[12px] text-muted-foreground">Add a graphic with <code>![alt text](https://…png)</code> or a clip with <code>[video](https://youtu.be/… or …mp4)</code> on its own line. <code>**bold**</code> and <code>[link](https://…)</code> work too.</p>
      </div>
      {err && <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="lime" size="sm" disabled={busy || (!dirty && !!item.id)}>{busy ? "Saving…" : item.id ? "Save" : "Add question"}</Button>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={d.published} onChange={(e) => setD({ ...d, published: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--lime))]" />Published</label>
        {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        {onDelete && <Button type="button" variant="danger" size="sm" className="ml-auto" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete</Button>}
      </div>
    </form>
  );
}

export function FaqEditor({ initial, categories }: { initial: F[]; categories: string[] }) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [del, setDel] = useState<F | null>(null);
  const toast = useToast();
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? items.filter((i) => (i.question + " " + i.answer).toLowerCase().includes(n)) : items;
  }, [items, q]);

  async function remove() {
    if (!del) return;
    try {
      await adminApi(`/api/admin/faq/${del.id}`, { method: "DELETE" });
      setItems((x) => x.filter((i) => i.id !== del.id));
      toast("Deleted");
    } catch (e: any) {
      toast(e.message, "error");
    }
    setDel(null);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search questions" />
        <Button variant="lime" size="sm" onClick={() => setAdding((a) => !a)}><Plus className="h-4 w-4" aria-hidden />New question</Button>
      </div>
      <div className="liquid-panel" data-open={adding}>
        <div>
          <Card className="liquid-inner">{adding && <Form item={NEW(categories[0])} categories={categories} onCancel={() => setAdding(false)} onSaved={(f) => { setItems((x) => [...x, f]); setAdding(false); }} />}</Card>
        </div>
      </div>
      {categories.map((c) => {
        const list = shown.filter((i) => i.category === c);
        if (!list.length) return null;
        return (
          <Card key={c} className="p-3 sm:p-4">
            <h2 className="mb-1 px-2 font-display text-[1rem] font-semibold">{c} <span className="text-[12.5px] font-normal text-muted-foreground">· {list.length}</span></h2>
            <ul>
              {list.map((i) => {
                const on = open === i.id;
                return (
                  <li key={i.id} className="border-b border-border/60 last:border-0">
                    <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : i.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-foreground/[0.03]">
                      {i.published ? <Eye className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Published" /> : <EyeOff className="h-4 w-4 shrink-0 text-warning" aria-label="Draft" />}
                      <span className={cn("flex-1 text-[14.5px] font-medium", !i.published && "text-muted-foreground")}>{i.question}</span>
                      {!i.published && <Pill tone="warn">draft</Pill>}
                      <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-300", on && "rotate-180")} aria-hidden />
                    </button>
                    <div className="liquid-panel" data-open={on}>
                      <div><div className="liquid-inner px-2 pb-4">{on && <Form item={i} categories={categories} onSaved={(f) => setItems((x) => x.map((y) => (y.id === f.id ? f : y)))} onDelete={() => setDel(i)} />}</div></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      {!shown.length && <p className="py-10 text-center text-muted-foreground">No questions match "{q}".</p>}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this question?" body={del?.question ?? ""} confirmLabel="Delete" onConfirm={remove} />
    </div>
  );
}
