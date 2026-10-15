"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { MASCOT_DEFAULT, PIP_PALETTES, PIP_SITUATIONS, paletteById, type MascotConfig, type PipSituation } from "@/lib/mascot/palettes";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

const swatch = (id: string) => {
  const p = paletteById(id);
  return {
    background: `radial-gradient(circle at 35% 30%, ${p.body[0]}, ${p.body[1]} 55%, ${p.body[2]})`,
    boxShadow: `0 6px 18px -6px ${p.halo}`,
  };
};

/**
 * Admin > Mascot colours. Same Pip, a colourway per situation, picked like the profile colours in
 * Settings. Each pick saves at once (optimistic, rolls back on error); the site follows within a minute.
 */
export function MascotPicker({ initial }: { initial: MascotConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState<PipSituation | "all" | null>(null);

  async function save(next: MascotConfig, who: PipSituation | "all", msg: string) {
    const prev = cfg;
    setCfg(next);
    setBusy(who);
    try {
      const r = await adminApi<{ mascot: MascotConfig }>("/api/admin/mascot", { method: "PUT", json: { situations: next.situations } });
      setCfg(r.mascot);
      toast(msg);
    } catch (e) {
      setCfg(prev);
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const pick = (s: (typeof PIP_SITUATIONS)[number], id: string) =>
    save({ situations: { ...cfg.situations, [s.id]: id } }, s.id, `${s.name} Pip is now ${paletteById(id).name}. Live on the site within a minute.`);
  const isDefault = PIP_SITUATIONS.every((s) => cfg.situations[s.id] === MASCOT_DEFAULT.situations[s.id]);

  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle
          hint="How Pip looks right now in each moment. Pick a colour below to change one."
          action={
            <button
              type="button"
              disabled={isDefault || busy !== null}
              onClick={() => save(MASCOT_DEFAULT, "all", "Pip is back to the original colours.")}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[13px] font-medium hairline hover:bg-secondary disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset to original
            </button>
          }
        >
          Lineup
        </CardTitle>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {PIP_SITUATIONS.map((s) => (
            <li key={s.id} className="flex flex-col items-center gap-1 rounded-2xl bg-secondary/40 p-3 text-center hairline">
              <Pip size={64} mood={s.mood as PipMood} palette={cfg.situations[s.id]} situation={s.id} />
              <span className="text-[13px] font-medium leading-tight">{s.name}</span>
              <span className="text-[12px] text-muted-foreground">{paletteById(cfg.situations[s.id]).name}</span>
            </li>
          ))}
        </ul>
      </Card>

      {PIP_SITUATIONS.map((s) => {
        const cur = cfg.situations[s.id];
        const changed = cur !== MASCOT_DEFAULT.situations[s.id];
        return (
          <Card key={s.id}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="grid h-28 w-28 shrink-0 place-items-center self-center rounded-3xl bg-secondary/40 hairline sm:self-start">
                <Pip size={92} mood={s.mood as PipMood} palette={cur} situation={s.id} />
              </div>
              <fieldset className="min-w-0 flex-1" disabled={busy !== null && busy !== s.id}>
                <legend className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  {s.name}
                  <Pill tone={changed ? "ok" : "muted"}>{busy === s.id ? "Saving" : paletteById(cur).name}</Pill>
                </legend>
                <p className="mt-1 text-[13px] text-muted-foreground">{s.hint}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {PIP_PALETTES.map((p) => (
                    <label key={p.id} className="av-opt relative cursor-pointer" title={p.name}>
                      <input type="radio" name={`pip-${s.id}`} value={p.id} checked={cur === p.id} onChange={() => pick(s, p.id)} className="peer sr-only" />
                      <span className={cn("av-swatch block h-11 w-11 rounded-full transition-transform", cur === p.id && "av-on")} style={swatch(p.id)} aria-hidden />
                      <span className="sr-only">{p.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
