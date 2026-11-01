"use client";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { api, ApiError } from "@/lib/client/api";
import { COVER_MAX_BYTES, COVER_SUPPORT, PLATFORM_META, type Platform } from "@/lib/domain";
import { toCoverJpeg } from "@/lib/client/cover";

interface Props {
  targets: Platform[];
  coverUrl: string | null;
  /** Saves the draft if it isn't yet and returns its id (a cover belongs to a saved post). Throws with a reason. */
  ensurePost: () => Promise<string | null>;
  onChange: (url: string | null) => void;
}

const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

/**
 * 1083: an optional cover image. It goes to the platforms whose APIs take one (YouTube, Instagram, Facebook,
 * LinkedIn); the rest pick a frame from the video themselves, and the card says so up front.
 */
export function CoverPicker({ targets, coverUrl, ensurePost, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"up" | "rm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const takes = targets.filter((t) => COVER_SUPPORT[t] === "upload");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("up");
    try {
      const jpeg = await toCoverJpeg(file, COVER_MAX_BYTES);
      const id = await ensurePost();
      if (!id) throw new Error("Save the draft first, then add a cover.");
      const r = await api<{ coverUrl: string | null }>(`/api/posts/${id}/cover`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: jpeg });
      onChange(r.coverUrl);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "That cover didn't upload. Try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setError(null);
    setBusy("rm");
    try {
      const id = await ensurePost();
      if (id) await api(`/api/posts/${id}/cover`, { method: "DELETE" });
      onChange(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove the cover. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!targets.length) return null;
  return (
    <section aria-labelledby="cover-pick" className="mt-8 rounded-[24px] p-4 text-left hairline sm:p-5">
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy !== null || !takes.length}
          aria-label={coverUrl ? "Change the cover image" : "Add a cover image"}
          className="relative grid aspect-[9/16] w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-secondary/70 text-muted-foreground outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 hairline"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {coverUrl ? <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5" aria-hidden="true" />}
          {busy === "up" && (
            <span className="absolute inset-0 grid place-items-center bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <h3 id="cover-pick" className="text-sm font-semibold">
            Cover image <span className="font-normal text-muted-foreground">(optional)</span>
          </h3>
          {takes.length ? (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {coverUrl ? "This cover goes" : "Pick the picture people see before they tap play. It goes"} on {join(takes.map((t) => PLATFORM_META[t].name))}. Best at 1080 x 1920, the same shape as your video.
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">None of the platforms you picked let apps set a cover, so each one uses a frame from your video.</p>
          )}
          {takes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="subtle" size="sm" onClick={() => input.current?.click()} disabled={busy !== null}>
                <ImagePlus className="h-4 w-4" aria-hidden="true" /> {coverUrl ? "Change" : "Add a cover"}
              </Button>
              {coverUrl && (
                <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy !== null}>
                  {busy === "rm" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />} Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {takes.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Where the cover goes">
          {targets.map((t) => (
            <li key={t} className="flex items-start gap-2.5 text-[13px] leading-snug">
              <PlatformOrb platform={t} size={22} />
              <span>
                <span className="font-medium">{PLATFORM_META[t].name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {t === "youtube"
                    ? "uses it if your channel is verified (a one-time phone check at youtube.com/verify)."
                    : COVER_SUPPORT[t] === "upload"
                      ? "uses it."
                      : t === "tiktok"
                        ? "only lets apps pick a frame, so it uses the first frame of your video."
                        : "doesn't let apps set a cover, so it uses a frame from your video."}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[hsl(0_72%_42%)] dark:text-destructive">
          {error}
        </p>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pick(e.target.files?.[0])} />
    </section>
  );
}
