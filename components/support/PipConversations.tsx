"use client";
import { MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/** 1151: one saved chat with Pip, as listed on the Help centre page. Mirrors ConvListItem in lib/support/conversations. */
export type PipConvItem = { id: string; ref: string; subject: string; status: "open" | "pending" | "resolved"; updatedAt: string; messages: number; sentTo: string | null };

const STATUS: Record<PipConvItem["status"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-warning/15 pill-ink-warn" },
  pending: { label: "Sending transcript", cls: "bg-accent/15 pill-ink-info" },
  resolved: { label: "Resolved", cls: "bg-success/15 pill-ink-ok" },
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * "Your Pip conversations" (1151): the real place past chats live, so Pip can point here instead of a made-up
 * "Chat History". Continue in Pip opens that conversation in the chat; a resolved one opens resolved, with
 * its own Reopen button, so nothing reopens unless the person asks.
 */
export function PipConversations({ items }: { items: PipConvItem[] }) {
  const open = (id: string) => window.dispatchEvent(new CustomEvent("outly:pip-conversation", { detail: id }));
  return (
    <section id="pip-conversations" aria-labelledby="pip-conv-h" className="ap-tile mt-3 scroll-mt-24 p-5">
      <h2 id="pip-conv-h" className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
        <MessagesSquare className="h-4 w-4" aria-hidden="true" /> Your Pip conversations
      </h2>
      {items.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((c) => {
            const s = STATUS[c.status] ?? STATUS.open;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[hsl(var(--ap-canvas))] p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{c.subject}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="tabular">{c.ref}</span> · {c.messages} {c.messages === 1 ? "message" : "messages"} · updated {day(c.updatedAt)}
                    {c.sentTo ? ` · transcript sent to ${c.sentTo}` : ""}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}>{s.label}</span>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  aria-label={`Continue in Pip: ${c.subject}`}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-foreground/[0.06] px-4 text-sm font-semibold transition-colors hover:bg-foreground/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Continue in Pip
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">No saved chats yet. When you chat with Pip while signed in, the conversation is kept here for 90 days.</p>
      )}
    </section>
  );
}
