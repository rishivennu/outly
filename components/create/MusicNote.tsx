"use client";
import Link from "next/link";
import { ChevronDown, Music2, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORMS, type Platform } from "@/lib/domain";

/**
 * What each place does with music it didn't add itself. Plain facts only: no app can promise a song
 * is cleared, so nothing here does. Outlly never adds music; the sound in the file is what every place gets.
 */
export const MUSIC_RULES: Record<Platform, string> = {
  instagram: "Instagram doesn't let apps add songs from its library. A popular song already in your video can get muted.",
  youtube: "YouTube can put a copyright claim on a song in your video. The owner can then block it or earn from it.",
  x: "X can take a post down if a rights holder reports the music.",
  tiktok: "TikTok doesn't let apps add sounds from its library. A song already in your video can get muted.",
  threads: "Threads can mute a song in your video, the same way Instagram does.",
  facebook: "Facebook can mute or block a video when its rights check finds a song.",
  linkedin: "LinkedIn can remove a post with music you don't have the rights to.",
};

/** Only the places this post is going to, in the usual order. */
export function musicLines(platforms: Platform[]): { platform: Platform; text: string }[] {
  return PLATFORMS.filter((p) => platforms.includes(p)).map((platform) => ({ platform, text: MUSIC_RULES[platform] }));
}

export const MUSIC_HELP = "/help?q=music";

interface Props {
  platforms: Platform[];
  /** Back to step 1, where the creator swaps in the version that has the music. Left out, no Replace button. */
  onReplace?: () => void;
}

/** Closed by default: one line until the creator asks for more. */
export function MusicNote({ platforms, onReplace }: Props) {
  const lines = musicLines(platforms);
  if (!lines.length) return null;
  return (
    <details className="group rounded-[20px] text-left hairline">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[20px] px-4 py-2.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Music2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1">Music and copyright</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="px-4 pb-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Outlly posts your video with the sound already in it. It can&apos;t add music for you. Use music you have the rights to.
        </p>
        {onReplace && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Want a song on it? Add it in your editor, export the video, then use Replace video. Your words stay as they are.</p>}
        <ul className="mt-3 space-y-2" aria-label="What each place does with music">
          {lines.map((l) => (
            <li key={l.platform} className="flex items-start gap-2.5 text-[13px] leading-snug">
              <PlatformOrb platform={l.platform} size={20} />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onReplace && (
            <Button variant="subtle" size="sm" onClick={onReplace}>
              <Replace className="h-4 w-4" aria-hidden="true" /> Replace video
            </Button>
          )}
          <Link href={MUSIC_HELP} className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium underline underline-offset-4">
            More in the Help centre
          </Link>
        </div>
      </div>
    </details>
  );
}
