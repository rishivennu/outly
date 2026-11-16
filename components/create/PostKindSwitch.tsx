import Link from "next/link";
import { Film, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 1132: the first question on a new post: a video, or a photo? Video is the full journey (every platform);
 * Photo opens the Instagram composer (photo, carousel or Story). Plain links, so it works before any script
 * loads and the browser's back button undoes a pick.
 */
const KINDS = [
  { kind: "video", href: "/create", label: "Video", icon: Film, hint: "Reels, Shorts, X and more" },
  { kind: "photo", href: "/create?format=photo", label: "Photo", icon: ImageIcon, hint: "Photo, carousel or Story on Instagram" },
] as const;

/** 1170: `inline` is Step 1's compact segmented control: left aligned, one line, the hint beside it. */
export function PostKindSwitch({ value, className, inline }: { value: "video" | "photo"; className?: string; inline?: boolean }) {
  if (inline)
    return (
      <nav aria-label="What are you posting?" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
        <ul className="inline-grid grid-cols-2 gap-1 rounded-full bg-secondary/60 p-1 hairline">
          {KINDS.map(({ kind, href, label, icon: Icon, hint }) => {
            const on = kind === value;
            return (
              <li key={kind}>
                <Link
                  href={href}
                  aria-current={on ? "page" : undefined}
                  title={hint}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                    on ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-background/60 [@media(hover:hover)]:hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          {value === "video" ? "Video post for Reels, Shorts, X and more. Outlly writes the words for each place." : KINDS[1].hint}
        </p>
      </nav>
    );
  return (
    <nav aria-label="What are you posting?" className={cn("flex w-full flex-col items-center", className)}>
      <p className="mb-2 text-sm font-medium text-muted-foreground">What are you posting?</p>
      <ul className="grid w-full max-w-sm grid-cols-2 gap-1.5 rounded-full bg-secondary/60 p-1.5 hairline">
        {KINDS.map(({ kind, href, label, icon: Icon, hint }) => {
          const on = kind === value;
          return (
            <li key={kind}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                title={hint}
                className={cn(
                  "flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
                  on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-center text-xs text-muted-foreground">{KINDS.find((k) => k.kind === value)!.hint}</p>
    </nav>
  );
}
