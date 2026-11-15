"use client";
import { useId, useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import type { Draft } from "@/lib/client/checks";
import { cn } from "@/lib/utils";
import { PreviewFor } from "./Previews";
import { aspectOf } from "./deck-logic";
import type { AccountView } from "./types";

interface Props {
  platform: Platform;
  draft: Draft;
  media: { src: string | null; poster: string | null; width?: number | null; height?: number | null };
  account?: AccountView;
  writing: boolean;
  /** Set for a place that is not connected yet: the line under the card saying nothing is sent there. */
  previewOnly?: string;
}

const FULL_SCREEN: Platform[] = ["instagram", "youtube", "tiktok"];

/**
 * The live preview beside the form. One player only, poster until play. On phones it folds away behind a
 * button so the fields come first; from lg up it is always open and sticks while the form scrolls.
 */
export function PlatformPreview({ platform, draft, media, account, writing, previewOnly }: Props) {
  // A preview-only place has no fields to come first, so its preview starts open on phones too.
  const [open, setOpen] = useState(!!previewOnly);
  const id = useId();
  const aspect = aspectOf(media);
  const meta = PLATFORM_META[platform];
  const props = {
    draft,
    src: media.src,
    poster: media.poster,
    handle: account?.username ?? `your${platform}`,
    name: account?.displayName ?? account?.username ?? "You",
    avatar: account?.avatar,
    aspect,
    interactive: true,
  };
  return (
    <div className="min-w-0 lg:sticky lg:top-24">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl bg-secondary/50 px-4 text-sm font-medium hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground lg:hidden"
      >
        <span className="flex items-center gap-2"><Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {open ? "Hide preview" : `Preview on ${meta.name}`}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-nav ease-out motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={id} className={cn("mt-3 lg:mt-0 lg:block", open ? "block" : "hidden")}>
        <p className="mb-3 hidden text-[13px] font-medium text-muted-foreground lg:block">{previewOnly ? `How it would look on ${meta.name}` : `How it looks on ${meta.name}`}</p>
        {writing ? (
          <div
            className={cn("skeleton mx-auto w-full rounded-[26px]", FULL_SCREEN.includes(platform) ? "aspect-[9/16] max-w-[320px]" : "aspect-[4/5] max-w-[440px]")}
            aria-label="Writing the copy"
            role="status"
          />
        ) : (
          <>
            {previewOnly && (
              <p className="mb-2 flex justify-center">
                <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs font-semibold text-muted-foreground hairline">Connect to send</span>
              </p>
            )}
            <PreviewFor platform={platform} {...props} className={FULL_SCREEN.includes(platform) ? "max-w-[320px]" : undefined} />
          </>
        )}
        {previewOnly ? (
          <p className="mt-3 text-center text-[13px] text-muted-foreground">{previewOnly}</p>
        ) : draft.enabled ? null : (
          <p className="mt-3 text-center text-[13px] text-muted-foreground">Skipped. Turn it on to send it here.</p>
        )}
      </div>
    </div>
  );
}
