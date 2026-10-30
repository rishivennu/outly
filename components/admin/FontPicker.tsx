"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { FONT_SETS, FONTS_DEFAULT, fontCss, fontSetById, type FontConfig, type FontSetId } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

/** Apply a set to this tab right away (visitors get it from /api/pip-theme within 30 seconds). */
function applyHere(cfg: FontConfig) {
  let el = document.getElementById("font-live") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "font-live";
    document.head.appendChild(el);
  }
  el.textContent = fontCss(cfg);
}

/**
 * Admin > Site fonts. Seven sets, each previewed in its own faces and headline setting (weight, tracking,
 * leading) so they can be compared side by side before switching. A pick saves at once (optimistic, rolls back on error).
 */
export function FontPicker({ initial }: { initial: FontConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState<FontSetId | null>(null);

  async function pick(id: FontSetId) {
    if (id === cfg.set || busy) return;
    const prev = cfg;
    const next = { set: id };
    setCfg(next);
    setBusy(id);
    try {
      const r = await adminApi<{ fonts: FontConfig }>("/api/admin/fonts", { method: "PUT", json: next });
      setCfg(r.fonts);
      applyHere(r.fonts);
      toast(`Site fonts are now ${fontSetById(r.fonts.set).name}. Live for every visitor within 30 seconds.`);
    } catch (e) {
      setCfg(prev);
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardTitle hint={cfg.set === FONTS_DEFAULT.set ? "Using the default set, Manrope + Inter." : `Using ${fontSetById(cfg.set).name}.`}>Typeface</CardTitle>
      <fieldset disabled={busy !== null}>
        <legend className="sr-only">Site typeface</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {FONT_SETS.map((f) => {
            const on = cfg.set === f.id;
            return (
              <label
                key={f.id}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-4 rounded-3xl bg-secondary/40 p-5 hairline transition-shadow focus-within:ring-2 focus-within:ring-ring",
                  on && "ring-2 ring-foreground/70",
                )}
              >
                <input type="radio" name="site-fonts" value={f.id} checked={on} onChange={() => pick(f.id)} className="peer sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{f.name}</span>
                    {f.id === FONTS_DEFAULT.set && <Pill>Default</Pill>}
                  </span>
                  {on ? (
                    <Pill tone="ok">
                      <Check className="h-3 w-3" aria-hidden />
                      {busy === f.id ? "Saving" : "Live"}
                    </Pill>
                  ) : null}
                </span>
                {/* Preview in the set's own faces, whatever the site is using right now. */}
                <span aria-hidden className="block">
                  <span className="block text-[28px]" style={{ fontFamily: f.display, fontWeight: f.look.weight, letterSpacing: f.look.tracking, lineHeight: f.look.leading, fontVariationSettings: f.look.axes ?? "normal" }}>
                    Create once.{" "}
                    <span style={{ fontFamily: f.serif, fontStyle: "italic", fontWeight: f.accent?.weight ?? 400, letterSpacing: f.accent?.tracking }}>Publish</span> everywhere.
                  </span>
                  <span className="mt-3 block text-[15px] leading-relaxed text-muted-foreground" style={{ fontFamily: f.body }}>
                    Upload one video and Outlly tailors it for Reels, Shorts and X. 0123456789
                  </span>
                </span>
                <span className="text-[13px] text-muted-foreground">{f.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
}
