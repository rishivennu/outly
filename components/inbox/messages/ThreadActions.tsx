"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Archive, ArchiveRestore, Mail, MailOpen, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Phase 2 (1155): read and archive for one conversation, in Outlly only. Archive says so in its label because
 * Instagram and Facebook keep the conversation where it was.
 */
export function ThreadActions({ name, unread, archived, onRead, onArchive, className }: { name: string; unread: boolean; archived: boolean; onRead: (read: boolean) => void; onArchive: (archived: boolean) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const item = cn("flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm text-foreground transition-colors duration-150 motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary", ring);

  return (
    <div ref={wrap} className={cn("relative shrink-0", className)}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`More for the conversation with ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn("grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-150 active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground", ring)}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div id={id} role="menu" aria-label={`Conversation with ${name}`} className="absolute right-0 top-full z-20 mt-1 w-[min(16rem,calc(100vw-2rem))] rounded-2xl bg-card p-1.5 shadow-lg hairline">
          <button type="button" role="menuitem" className={item} onClick={() => pick(() => onRead(unread))}>
            {unread ? <MailOpen className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {unread ? "Mark as read" : "Mark as unread"}
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => pick(() => onArchive(!archived))}>
            {archived ? <ArchiveRestore className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Archive className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>
              {archived ? "Move back to inbox" : "Archive in Outlly"}
              <span className="block text-xs text-muted-foreground">{archived ? "Shows in your conversations again" : "Hides it here only. A new message brings it back."}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
