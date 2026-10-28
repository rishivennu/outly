import { Check, ChevronDown, Minus, X, CircleHelp } from "lucide-react";
import { AppIcon, type Brand } from "@/components/brand/brands";
import { Shell, SectionHead } from "./bits";
import { COMPETITORS, ROWS, ROW_GROUPS, CELL_LABEL, COMPARISON_DISCLAIMER, type Cell } from "@/lib/marketing/comparison";
import { Reveal } from "./Reveal";
import { CmpExpandAll } from "./CmpExpandAll";
import { cn } from "@/lib/utils";

const MARK: Record<Cell, { Icon: typeof Check; tone: string; chip: string }> = {
  yes: { Icon: Check, tone: "pill-ink-ok", chip: "cmp-yes" },
  no: { Icon: X, tone: "pill-ink-bad", chip: "cmp-no" },
  partial: { Icon: Minus, tone: "pill-ink-warn", chip: "cmp-partial" },
  unknown: { Icon: CircleHelp, tone: "text-muted-foreground", chip: "cmp-unknown" },
};

/**
 * The comparison draws ~160 status icons. Each is a <use> of one shared symbol instead of a
 * full inline SVG, which takes a big bite out of the landing page's HTML (and so its load time
 * for every visitor). Same lucide shapes, same look.
 */
const CELLS = Object.keys(MARK) as Cell[];
function CmpSprite() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        {CELLS.map((k) => {
          const { Icon } = MARK[k];
          return (
            <symbol key={k} id={`cmp-${k}`} viewBox="0 0 24 24">
              <Icon strokeWidth={3} />
            </symbol>
          );
        })}
      </defs>
    </svg>
  );
}

function CmpIcon({ value, small }: { value: Cell; small?: boolean }) {
  return (
    <svg className={small ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" focusable="false">
      <use href={`#cmp-${value}`} />
    </svg>
  );
}

/** Feature column + one column per tool. Header, rows and the open panel all share it, so they line up. */
// The column count follows the admin's landing switches (--cmp-n = Outlly + the competitors left on).
const GRID = "grid grid-cols-[repeat(var(--cmp-n),minmax(0,1fr))] gap-1 lg:grid-cols-[minmax(0,1.6fr)_repeat(var(--cmp-n),minmax(0,1fr))] lg:gap-2";
type Tool = { id: string; name: string; sub: string };
const ALL_TOOLS: Tool[] = [{ id: "outly", name: "Outlly", sub: "Beta, free" }, ...COMPETITORS.map((c) => ({ id: c.id, name: c.name, sub: `Checked ${c.lastVerified}` }))];
type Flags = Record<string, boolean> | undefined;

/**
 * Apple-style compare, built to stay short: groups fold (the first starts open), and every row
 * shows only the verdicts. Opening a row lays the reasons out as a bento of cards, one per tool,
 * so the words get room instead of being squeezed into a 150px column.
 * Native <details> throughout: works before hydration and with the keyboard.
 */
function CompareGrid({ tools, groups }: { tools: Tool[]; groups: Flags }) {
  let r = 0;
  return (
    <div data-cmp className="mt-10 sm:mt-14" style={{ ["--cmp-n" as string]: tools.length }}>
      <div className="sticky top-[76px] z-10 sm:top-[84px]">
        <div className={cn(GRID, "items-end rounded-[22px] bg-card/95 px-3 py-3 shadow-[0_0_0_1px_hsl(var(--foreground)/.08),0_12px_28px_-18px_rgba(0,0,0,.45)] backdrop-blur-md sm:px-5 lg:py-4")}>
          <div className="hidden items-center lg:flex">
            <CmpExpandAll />
          </div>
          {tools.map((t) => (
            <span key={t.id} className="flex min-w-0 flex-col items-center gap-1.5 text-center" aria-hidden="true">
              <span className="lg:hidden"><AppIcon brand={t.id as Brand} size={26} /></span>
              <span className="hidden lg:block"><AppIcon brand={t.id as Brand} size={40} /></span>
              <span className={cn("max-w-full truncate text-[11px] font-semibold leading-tight lg:text-[15px]", t.id === "outly" ? "text-foreground" : "text-foreground/75")}>{t.name}</span>
              <span className="hidden text-[12px] leading-tight text-muted-foreground lg:block">{t.sub}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 px-1 lg:hidden">
        <p className="text-[12.5px] text-foreground/65">Tap a row for the reasons.</p>
        <CmpExpandAll />
      </div>
      <p className="mt-3 hidden px-1 text-[13px] text-foreground/65 lg:block">Click any row to see the reasons behind each answer.</p>

      {ROW_GROUPS.map((g, gi) => {
        const rows = ROWS.slice(r, r + g.rows);
        r += g.rows;
        if (groups?.[g.label] === false) return null;
        const ours = rows.filter((x) => x.outly.value === "yes").length;
        return (
          <details key={g.label} data-cmp-group open={gi === ROW_GROUPS.findIndex((x) => groups?.[x.label] !== false)} className="group/g ap-tile mt-4 !rounded-[26px] shadow-[0_0_0_1px_hsl(var(--foreground)/.06)]">
            <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-3 px-4 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <h3 className="font-display text-[20px] font-bold leading-tight tracking-[-0.02em] sm:text-[24px]">{g.label}</h3>
                <span className="text-[13px] text-muted-foreground">
                  {g.rows} {g.rows === 1 ? "row" : "rows"} · Outlly yes on {ours}
                </span>
              </span>
              <span className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground/[0.06]">
                <ChevronDown className="h-4 w-4 transition-transform duration-300 group-open/g:rotate-180" aria-hidden="true" />
              </span>
            </summary>
            <ul className="px-2 pb-2 sm:px-3">
              {rows.map((row) => {
                const cells = tools.map((t) => ({ ...t, cell: t.id === "outly" ? row.outly : row.cells[t.id] ?? { value: "unknown" as Cell } }));
                return (
                  <li key={row.feature} className="border-t border-border">
                    <details className="group/row">
                      <summary className="block cursor-pointer list-none rounded-2xl px-2 py-3 transition-colors hover:bg-foreground/[0.03] sm:px-3 lg:py-3.5 [&::-webkit-details-marker]:hidden">
                        <span className={cn(GRID, "items-center")}>
                          <span className="col-span-full flex items-start justify-between gap-3 pb-2.5 lg:col-span-1 lg:pb-0">
                            <span className="font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] lg:text-[16px]">{row.feature}</span>
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-foreground/50 transition-transform duration-300 group-open/row:rotate-180" aria-hidden="true" />
                          </span>
                          {cells.map(({ id, name, cell }) => (
                            <span key={id} className={cn("cmp-slot lg:flex lg:h-11 lg:items-center lg:justify-center lg:gap-2", id === "outly" && "cmp-slot-us")}>
                              <span className={cn("cmp-chip", MARK[cell.value].chip)}>
                                <CmpIcon value={cell.value} />
                              </span>
                              <span className="sr-only">{name}: </span>
                              <span className={cn("hidden text-[13.5px] font-semibold lg:inline", MARK[cell.value].tone)}>{CELL_LABEL[cell.value]}</span>
                              <span className="sr-only lg:hidden">{CELL_LABEL[cell.value]}.</span>
                            </span>
                          ))}
                        </span>
                      </summary>
                      <div className="px-2 pb-4 pt-1 sm:px-3">
                        {row.detail && <p className="mb-3 max-w-2xl text-[14px] leading-relaxed text-foreground/70">{row.detail}</p>}
                        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[repeat(var(--cmp-n),minmax(0,1fr))]">
                          {cells.map(({ id, name, cell }) => (
                            <li key={id} className={cn("cmp-note rounded-[18px] p-4", id === "outly" && "cmp-note-us sm:col-span-2 lg:col-span-1")}>
                              <span className="flex items-center gap-2">
                                <AppIcon brand={id as Brand} size={24} />
                                <span className="font-display text-[14.5px] font-semibold">{name}</span>
                              </span>
                              <span className="mt-3 flex items-center gap-1.5">
                                <span className={cn("cmp-chip cmp-chip-sm", MARK[cell.value].chip)}>
                                  <CmpIcon value={cell.value} small />
                                </span>
                                <span className={cn("text-[14px] font-semibold", MARK[cell.value].tone)}>{CELL_LABEL[cell.value]}</span>
                              </span>
                              {cell.note && <p className="mt-2 text-[13.5px] leading-relaxed text-foreground/75">{cell.note}</p>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}

      <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 px-1 text-[12.5px] text-foreground/70" aria-label="Legend">
        {CELLS.map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("cmp-chip cmp-chip-sm", MARK[k].chip)}>
              <CmpIcon value={k} small />
            </span>
            {CELL_LABEL[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Comparison({ competitors, groups, beta = false }: { competitors?: Flags; groups?: Flags; beta?: boolean } = {}) {
  const tools = ALL_TOOLS.filter((t) => t.id === "outly" || competitors?.[t.id] !== false).map((t) => (t.id === "outly" && !beta ? { ...t, sub: "Free plan" } : t));
  const shownCompetitors = COMPETITORS.filter((c) => competitors?.[c.id] !== false);
  const names = shownCompetitors.map((c) => c.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "the big suites";
  return (
    <section id="compare" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="compare-title">
      <CmpSprite />
      <Shell>
        <SectionHead
          id="compare-title"
          align="center"
          eyebrow="Honest comparison"
          title={<>Outlly, next to the <span className="accent-serif">big suites.</span></>}
          body={`Read this as a shape comparison, not a scoreboard. ${list} ${names.length === 1 ? "does" : "each do"} a great deal that Outlly does not, and the rows where they win are here too.`}
        />

        <Reveal y={36} fx="rows">
          <CompareGrid tools={tools} groups={groups} />
        </Reveal>

        <details className="group/src ap-canvas mx-auto mt-10 max-w-[980px] rounded-[24px] px-5 py-3 sm:px-7">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[15px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            How we checked, and sources
            <ChevronDown className="h-4 w-4 transition-transform duration-300 group-open/src:rotate-180" aria-hidden="true" />
          </summary>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">{COMPARISON_DISCLAIMER}</p>

        <Reveal as="ul" stagger className="mb-4 mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shownCompetitors.map((c) => (
            <li key={c.id} className="ap-tile flex gap-3 !rounded-[18px] p-4 text-[14px] leading-relaxed text-muted-foreground">
              <AppIcon brand={c.id as Brand} size={32} className="shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-display font-semibold text-foreground">{c.name}.</span> {c.positioning}{" "}
              <span className="whitespace-nowrap">Sources: </span>
              {c.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ", "}
                  <a href={s.url} rel="nofollow noopener noreferrer" target="_blank" className="underline decoration-border underline-offset-2 hover:text-foreground">
                    {s.label}
                  </a>
                </span>
              ))}
              </span>
            </li>
          ))}
        </Reveal>
        </details>
      </Shell>
    </section>
  );
}
