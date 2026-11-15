import Link from "next/link";
import { FileText, Layers, Plus, CalendarCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * P2: the four things people open the calendar to start. Real routes only: /create opens on the upload, the batch
 * planner takes several videos at once, and Content opens straight on a tab with ?filter=.
 */
const ACTIONS = [
  { href: "/create", label: "New post", icon: Plus, lime: true },
  { href: "/create/bulk", label: "Upload videos", icon: Layers },
  { href: "/content?filter=draft", label: "Drafts", icon: FileText },
  { href: "/content?filter=scheduled", label: "Scheduled", icon: CalendarCheck },
] as const;

export function QuickActions({ className }: { className?: string }) {
  return (
    <nav aria-label="Quick actions" className={cn("grid grid-cols-2 gap-2 sm:flex sm:flex-wrap", className)}>
      {ACTIONS.map(({ href, label, icon: I, ...a }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-[background-color,transform,filter] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "lime" in a ? "lime-bg font-semibold [@media(hover:hover)]:hover:brightness-[1.06]" : "bg-secondary text-secondary-foreground hairline [@media(hover:hover)]:hover:bg-secondary/70",
          )}
        >
          <I className="h-4 w-4" aria-hidden="true" /> {label}
        </Link>
      ))}
    </nav>
  );
}
