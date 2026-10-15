"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { OrbArt } from "@/components/brand/OrbAvatar";
import { useToast } from "@/components/shared/Toast";
import { useUser } from "@/components/shell/UserContext";
import { ORB_COLORS, ORB_FACES, orbValue, resolveAvatar, type Orb } from "@/lib/avatar";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

/**
 * Pick a glowing orb: a colour and a face. Native radio groups, so arrow keys move between
 * choices and screen readers announce "Mint, 2 of 9". Saves the moment you choose.
 */
export function AvatarPicker() {
  const user = useUser();
  const router = useRouter();
  const toast = useToast();
  const start = resolveAvatar(user.avatar, user.email);
  const [orb, setOrb] = useState<Orb>("orb" in start ? start.orb : { color: "lilac", face: "shy" });
  const [saving, setSaving] = useState(false);
  const hasPhoto = "photo" in start;

  const choose = async (next: Orb) => {
    const prev = orb;
    setOrb(next);
    setSaving(true);
    try {
      await api("/api/settings/profile", { method: "PATCH", json: { avatar: orbValue(next) } });
      router.refresh();
    } catch (err) {
      setOrb(prev);
      toast(err instanceof ApiError ? err.message : "Something got in the way.", "error");
    } finally {
      setSaving(false);
    }
  };
  const colorName = ORB_COLORS.find((c) => c.id === orb.color)?.name;
  const faceName = ORB_FACES.find((f) => f.id === orb.face)?.name;

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }} className="glass rounded-[32px] p-6 sm:p-8 lg:col-span-2" aria-labelledby="av-h" aria-busy={saving}>
      <div className="flex flex-wrap items-center gap-5">
        <OrbArt orb={orb} size={88} label={`Your avatar: ${colorName} orb, ${faceName} face`} className="av-preview" />
        <div className="min-w-0 flex-1">
          <h2 id="av-h" className="text-2xl font-semibold tracking-tight">Avatar</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Pick a colour and a face. It shows in the sidebar and on your support tickets.{hasPhoto ? " Choosing one replaces your sign-in photo." : ""}
          </p>
          <p className="mt-1 text-sm font-medium" aria-live="polite">{saving ? "Saving" : `${colorName}, ${faceName}`}</p>
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="eyebrow mb-3">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {ORB_COLORS.map((c) => (
            <label key={c.id} className="av-opt relative cursor-pointer">
              <input type="radio" name="av-color" value={c.id} checked={orb.color === c.id} onChange={() => choose({ ...orb, color: c.id })} className="peer sr-only" />
              <span className={cn("av-swatch grid h-12 w-12 place-items-center rounded-full transition-transform", orb.color === c.id && "av-on")} style={{ background: `radial-gradient(circle at 35% 30%, ${c.light}, ${c.base} 55%, ${c.deep})`, boxShadow: `0 6px 18px -6px ${c.base}` }} aria-hidden />
              <span className="sr-only">{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="eyebrow mb-3">Face</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-9">
          {ORB_FACES.map((f) => (
            <label key={f.id} className="av-opt relative cursor-pointer">
              <input type="radio" name="av-face" value={f.id} checked={orb.face === f.id} onChange={() => choose({ ...orb, face: f.id })} className="peer sr-only" />
              <span className={cn("av-face flex flex-col items-center gap-1 rounded-2xl p-2 transition-colors", orb.face === f.id && "av-on")}>
                <OrbArt orb={{ color: orb.color, face: f.id }} size={52} />
                <span className="text-[12px] font-medium">{f.name}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </motion.section>
  );
}
