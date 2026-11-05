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

export function PostKindSwitch({ value, className }: { value: "video" | "photo"; className?: string }) {
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
