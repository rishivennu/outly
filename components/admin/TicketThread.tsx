"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Send } from "lucide-react";
import { Pip } from "@/components/brand/Pip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card } from "./ui";

type T = { id: string; ref: string; subject: string; status: string; priority: string; email: string; name: string | null; source: string; createdAt: string };
type M = { id: string; author: string; authorName: string | null; body: string; createdAt: string };

const sel = "h-9 rounded-full bg-secondary/60 px-3 text-[13px] font-semibold hairline";

export function TicketThread({ ticket, messages: initial }: { ticket: T; messages: M[] }) {
  const [t, setT] = useState(ticket);
  const [messages, setMessages] = useState(initial);
  const [body, setBody] = useState("");
  const [after, setAfter] = useState<"pending" | "resolved">("pending");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function patch(d: Partial<Pick<T, "status" | "priority">>) {
    const prev = t;
    setT({ ...t, ...d });
    try {
      await adminApi(`/api/admin/tickets/${t.id}`, { method: "PATCH", json: d });
      router.refresh();
    } catch (e: any) {
      setT(prev);
      toast(e.message, "error");
    }
  }
  async function reply(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await adminApi<{ message: any; status: string; emailed: boolean; mailStatus: string }>(`/api/admin/tickets/${t.id}`, { method: "POST", json: { body, status: after } });
      setMessages((m) => [...m, { ...r.message, createdAt: new Date(r.message.createdAt).toISOString() }]);
      setT((x) => ({ ...x, status: r.status }));
      setBody("");
      toast(r.mailStatus === "mocked" ? "Reply saved. Mock email is in the Outbox." : r.emailed ? `Reply emailed to ${t.email}` : "Reply saved, but the email failed. Check Integrations.", r.emailed ? "ok" : "error");
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[12px] text-muted-foreground">{t.ref}</p>
          <h1 className="font-display text-[1.35rem] font-bold leading-tight tracking-tight">{t.subject}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="tk-status">Status</label>
          <select id="tk-status" className={sel} value={t.status} onChange={(e) => patch({ status: e.target.value })}>
            <option value="open">Open</option><option value="pending">Waiting on customer</option><option value="resolved">Resolved</option>
          </select>
          <label className="sr-only" htmlFor="tk-prio">Priority</label>
          <select id="tk-prio" className={cn(sel, t.priority === "urgent" && "text-destructive", t.priority === "high" && "text-warning")} value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
            <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option>
          </select>
        </div>
      </div>

      <ol className="flex flex-col gap-3" aria-label="Conversation">
        <AnimatePresence initial={false}>
          {messages.map((m) => {
            const mine = m.author === "admin";
            const bot = m.author === "bot";
            return (
              <motion.li key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
                {bot ? <Pip size={30} mood="idle" /> : <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold", mine ? "lime-bg" : "bg-secondary")} aria-hidden>{(m.authorName ?? (mine ? "A" : t.name ?? t.email)).slice(0, 1).toUpperCase()}</span>}
                <div className={cn("max-w-[80%] rounded-[20px] px-4 py-2.5 text-[14px] leading-relaxed", mine ? "rounded-tr-md bg-lime/15" : bot ? "rounded-tl-md bg-secondary/60" : "rounded-tl-md bg-card hairline")}>
                  <p className="mb-0.5 text-[11.5px] font-semibold text-muted-foreground">{bot ? "Pip" : m.authorName ?? (mine ? "Team" : t.name ?? "Customer")} · {new Date(m.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      <form onSubmit={reply} className="mt-6 border-t border-border pt-5">
        <label htmlFor="tk-reply" className="mb-2 block text-[13px] font-medium text-muted-foreground">Reply to {t.name ?? t.email} (sent by email)</label>
        <Textarea id="tk-reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi, thanks for waiting…" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) reply(e as any); }} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="lime" disabled={busy || !body.trim()}><Send className="h-4 w-4" aria-hidden />{busy ? "Sending…" : "Send reply"}</Button>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            then mark as
            <select className={sel} value={after} onChange={(e) => setAfter(e.target.value as any)}>
              <option value="pending">Waiting on customer</option><option value="resolved">Resolved</option>
            </select>
          </label>
          <span className="ml-auto hidden text-[12px] text-muted-foreground sm:inline">Ctrl + Enter to send</span>
        </div>
      </form>
    </Card>
  );
}
