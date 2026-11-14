"use client";
import { Music2, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** "Instagram and YouTube": where this exact video, with its sound, is going. */
  list: string;
  /** Back to step 1, where the creator swaps in the version that has the music. */
  onReplace: () => void;
}

/**
 * Outlly never adds music. Instagram's and YouTube's APIs give other apps no way to use their music
 * libraries or trending sounds, so the creator adds the sound in their own editor, exports, and uploads
 * that file. Whatever sound is in the file is what every platform gets.
 */
export function MusicNote({ list, onReplace }: Props) {
  return (
    <section aria-labelledby="music-note" className="mt-8 rounded-[24px] p-4 text-left hairline sm:p-5">
      <h3 id="music-note" className="flex items-center gap-2 text-sm font-semibold">
        <Music2 className="h-4 w-4 text-accent" aria-hidden="true" /> Want trending music on it?
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Outlly posts your video exactly as you uploaded it, with its own sound. It can&apos;t add music for you: Instagram and YouTube don&apos;t let other apps use their music libraries.
      </p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>Open your video in the Instagram app, the YouTube app or an editor like CapCut, and add the sound you want. Burned captions in Outlly? Download that version in step 1 first, so the music goes on top of it.</li>
        <li>Export or save the video to your device without posting it.</li>
        <li>Upload that video here with Replace video. Your copy, hashtags and settings stay as they are.</li>
        <li>Outlly sends the same video, with the same sound, to {list}.</li>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Popular songs can get muted or claimed when they&apos;re posted from outside the app they came from, and some apps save the video without the song. Play the exported file before you upload it. Royalty-free sounds are the safest choice.
      </p>
      <Button variant="subtle" size="md" className="mt-4 w-full sm:w-auto" onClick={onReplace}>
        <Replace className="h-4 w-4" aria-hidden="true" /> Replace video
      </Button>
    </section>
  );
}
