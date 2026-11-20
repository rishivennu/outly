"use client";
import { useState } from "react";
import { ExternalLink, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { LANDING_COMPETITORS, LANDING_GROUPS, LANDING_SECTIONS, type LandingConfig } from "@/lib/landing";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";
import { Switch } from "./Switch";

type Part = keyof LandingConfig;

const State = ({ on }: { on: boolean }) => (
  <Pill tone={on ? "ok" : "muted"}>
    {on ? <Eye className="h-3 w-3" aria-hidden /> : <EyeOff className="h-3 w-3" aria-hidden />}
    {on ? "Shown" : "Hidden"}
  </Pill>
);

/**
 * Admin table of everything on the landing page with a show/hide switch per row, plus the comparison
 * table's own columns and row groups. Saves one switch at a time (optimistic, rolls back on error).
 */
export function LandingToggles({ initial }: { initial: LandingConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function flip(part: Part, key: string, v: boolean, label: string) {
    const prev = cfg;
    setCfg({ ...cfg, [part]: { ...cfg[part], [key]: v } });
    setBusy(`${part}.${key}`);
    try {
      const r = await adminApi<{ landing: LandingConfig }>("/api/admin/landing", { method: "PUT", json: { [part]: { [key]: v } } });
      setCfg(r.landing);
      toast(`${label} ${v ? "is back on" : "is hidden from"} the landing page.`);
    } catch (e) {
      setCfg(prev);
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const isOn = (part: Part, key: string) => (cfg[part] as Record<string, boolean>)?.[key] !== false;
  const shownCount = LANDING_SECTIONS.filter((s) => isOn("sections", s.id)).length;
  const compareOn = isOn("sections", "compare");
  const colsOn = LANDING_COMPETITORS.filter((c) => isOn("competitors", c.id)).length;
  const groupsOn = LANDING_GROUPS.filter((g) => isOn("groups", g)).length;

  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle
          hint={`${shownCount} of ${LANDING_SECTIONS.length} sections shown, top to bottom in page order.`}
          action={
            <Button asChild variant="outline" size="sm">
              <a href="/" target="_blank" rel="noopener noreferrer">
                Open the page <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
              </a>
            </Button>
          }
        >
          Sections
        </CardTitle>
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <table className="w-full border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold text-muted-foreground">
                <th scope="col" className="w-10 border-b border-border/60 pb-2 pr-2">#</th>
                <th scope="col" className="border-b border-border/60 pb-2 pr-3">Section</th>
                <th scope="col" className="hidden border-b border-border/60 pb-2 pr-3 md:table-cell">What it shows</th>
                <th scope="col" className="hidden border-b border-border/60 pb-2 pr-3 sm:table-cell">Status</th>
                <th scope="col" className="border-b border-border/60 pb-2 text-right">On the page</th>
              </tr>
            </thead>
            <tbody>
              {LANDING_SECTIONS.map((s, i) => {
                const on = isOn("sections", s.id);
                return (
                  <tr key={s.id} className={cn("transition-opacity", !on && "opacity-70")}>
                    <td className="border-b border-border/60 py-3 pr-2 align-middle font-mono text-[12px] tabular text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                    <td className="border-b border-border/60 py-3 pr-3 align-middle">
                      <span className="font-medium">{s.label}</span>
                      {"core" in s && s.core && <span className="ml-2 text-[11.5px] text-muted-foreground">recommended</span>}
                      <span className="mt-0.5 block text-[12px] text-muted-foreground md:hidden">{s.shows}</span>
                    </td>
                    <td className="hidden border-b border-border/60 py-3 pr-3 align-middle text-muted-foreground md:table-cell">{s.shows}</td>
                    <td className="hidden border-b border-border/60 py-3 pr-3 align-middle sm:table-cell"><State on={on} /></td>
                    <td className="border-b border-border/60 py-3 text-right align-middle">
                      <Switch on={on} disabled={busy === `sections.${s.id}`} label={`Show ${s.label} on the landing page`} onChange={(v) => flip("sections", s.id, v, s.label)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className={cn(!compareOn && "opacity-80")}>
        <CardTitle
          hint={compareOn ? `${colsOn} of ${LANDING_COMPETITORS.length} competitors and ${groupsOn} of ${LANDING_GROUPS.length} row groups shown. Outlly's own column always stays.` : "The comparison section is hidden, so these only apply once you switch it back on."}
          action={<Pill tone={compareOn ? "ok" : "muted"}>{compareOn ? "Section shown" : "Section hidden"}</Pill>}
        >
          Comparison table
        </CardTitle>
        <div className="grid gap-5 md:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold text-muted-foreground">Columns</legend>
            <ul className="grid gap-2">
              <li className="flex min-h-[52px] items-center justify-between gap-3 rounded-[16px] bg-secondary/40 px-4">
                <span className="font-medium">Outlly</span>
                <span className="text-[12px] text-muted-foreground">Always shown</span>
              </li>
              {LANDING_COMPETITORS.map((c) => {
                const on = isOn("competitors", c.id);
                const last = on && colsOn === 1;
                return (
                  <li key={c.id} className="flex min-h-[52px] items-center justify-between gap-3 rounded-[16px] bg-secondary/25 px-4">
                    <span className="min-w-0">
                      <span className="font-medium">{c.label}</span>
                      {last && <span className="block text-[11.5px] text-muted-foreground">Keep at least one to compare against</span>}
                    </span>
                    <Switch on={on} disabled={busy === `competitors.${c.id}` || last} label={`Show the ${c.label} column`} onChange={(v) => flip("competitors", c.id, v, `The ${c.label} column`)} />
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold text-muted-foreground">Row groups</legend>
            <ul className="grid gap-2">
              {LANDING_GROUPS.map((g) => {
                const on = isOn("groups", g);
                const last = on && groupsOn === 1;
                return (
                  <li key={g} className="flex min-h-[52px] items-center justify-between gap-3 rounded-[16px] bg-secondary/25 px-4">
                    <span className="min-w-0">
                      <span className="font-medium">{g}</span>
                      {last && <span className="block text-[11.5px] text-muted-foreground">Hide the whole section instead</span>}
                    </span>
                    <Switch on={on} disabled={busy === `groups.${g}` || last} label={`Show the ${g} rows`} onChange={(v) => flip("groups", g, v, `The ${g} rows`)} />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </div>
      </Card>
    </div>
  );
}
