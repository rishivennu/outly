"use client";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  selected: boolean;
  unread: boolean;
  name: string;
  avatar: ReactNode;
  time: string;
  timeTitle: string;
  preview: string;
  status: ReactNode;
  tag?: ReactNode;
  label: string;
  actions: ReactNode;
  onOpen: () => void;
};

/**
 * Phase 2 (1155): one conversation in the list. Same look as the comments row (InboxRow), plus a menu for
 * read and archive beside it, so they work without opening the conversation. The dot means unread.
 */
export const ThreadRow = forwardRef<HTMLButtonElement, Props>(function ThreadRow({ id, selected, unread, name, avatar, time, timeTitle, preview, status, tag, label, actions, onOpen }, ref) {
  return (
    <li className={cn("relative flex items-start border-b border-border/70", selected && "bg-secondary/80 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-lime")}>
      <button
        ref={ref}
        id={id}
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        className={cn(
          "relative flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-1 text-left transition-colors duration-150 motion-reduce:transition-none focus-visible:z-[1] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          !selected && "[@media(hover:hover)]:hover:bg-secondary/50",
        )}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("truncate text-[14px]", unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>{name}</span>
            {tag}
            <time className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground" title={timeTitle} suppressHydrationWarning>
              {time}
            </time>
            {unread && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-lime" />}
          </span>
          <span className={cn("mt-0.5 block truncate text-[14px]", unread ? "text-foreground" : "text-muted-foreground")}>{preview}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">{status}</span>
        </span>
      </button>
      <div className="pr-1.5 pt-2.5">{actions}</div>
    </li>
  );
});
