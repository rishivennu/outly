"use client";
import { useId, useState } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Google shows "Error 403: access_denied" on its own page while an app is in Testing, so Outlly never
 * hears about it. The only fix we can offer is telling people before they go, and after they come back.
 */
export function GoogleHelp({ className, defaultOpen = false, compact = false }: { className?: string; defaultOpen?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn("rounded-2xl bg-secondary/60 text-sm", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-2xl px-3.5 py-2 text-left font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span className="flex-1">{compact ? "Google says Error 403?" : "Seeing \u201cError 403: access_denied\u201d from Google?"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={id} hidden={!open} className="px-3.5 pb-3.5 text-muted-foreground">
        <p>
          Outlly hasn&apos;t finished Google&apos;s app verification yet, so Google only lets approved testers sign in. Nothing is wrong with your
          account.
        </p>
        <p className="mt-3 font-medium text-foreground">If you run this copy of Outlly</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>
            Open <span className="text-foreground">Google Cloud Console</span>, then <span className="text-foreground">Google Auth Platform</span>,
            then <span className="text-foreground">Audience</span>.
          </li>
          <li>
            Under <span className="text-foreground">Test users</span>, choose <span className="text-foreground">Add users</span> and enter the
            Gmail you sign in with.
          </li>
          <li>Save, wait a minute, and try again. Up to 100 testers are allowed.</li>
        </ol>
        <p className="mt-3 font-medium text-foreground">If someone else runs it</p>
        <p className="mt-1">Send them the Gmail address you use and ask to be added as a tester. Once Outlly is verified, this step goes away.</p>
      </div>
    </div>
  );
}
