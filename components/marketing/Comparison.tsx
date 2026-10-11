import { Fragment } from "react";
import { Check, Minus, X, CircleHelp } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { Shell, SectionHead } from "./bits";
import { COMPETITORS, ROWS, ROW_GROUPS, CELL_LABEL, COMPARISON_DISCLAIMER, type Cell } from "@/lib/marketing/comparison";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

const MARK: Record<Cell, { Icon: typeof Check; tone: string; chip: string }> = {
  yes: { Icon: Check, tone: "text-success", chip: "bg-success/[0.12] text-success" },
  no: { Icon: X, tone: "text-destructive", chip: "bg-destructive/10 text-destructive" },
  partial: { Icon: Minus, tone: "text-warning", chip: "bg-warning/[0.14] text-warning" },
  unknown: { Icon: CircleHelp, tone: "text-muted-foreground", chip: "bg-foreground/[0.06] text-muted-foreground" },
};

/** Icon + word, never colour alone; the note carries the detail. */
function CellMark({ value, note }: { value: Cell; note?: string }) {
  const { Icon, tone, chip } = MARK[value];
  return (
    <span className="flex flex-col gap-1.5">
      <span className={cn("inline-flex items-center gap-2 text-[14.5px] font-semibold", tone)}>
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", chip)}>
          <Icon className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
        {CELL_LABEL[value]}
      </span>
      {note && <span className="text-[13.5px] leading-[1.5] text-muted-foreground">{note}</span>}
    </span>
  );
}

const cols = COMPETITORS.length + 2;

export function Comparison() {
  let r = 0;
  return (
    <section id="compare" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="compare-title">
      <Shell>
        <SectionHead
          id="compare-title"
          eyebrow="Honest comparison"
          title={<>How Outly lines up against the <span className="accent-serif">big suites.</span></>}
          body="Read this as a shape comparison, not a scoreboard. Buffer, Metricool, Later and Hootsuite each do a great deal that Outly does not, and the rows where they win are in the table too."
        />

        <p className="mt-10 text-[13px] text-muted-foreground lg:hidden" aria-hidden="true">
          Scroll the table sideways to see all four competitors.
        </p>

        {/* tabindex: a scroll container has to be reachable without a pointer */}
        <Reveal y={36}>
        <div
          tabIndex={0}
          role="region"
          aria-label="Feature comparison table, scrollable horizontally"
          className="-mx-5 mt-3 overflow-x-auto overscroll-x-contain px-5 pb-2 sm:mx-0 sm:px-0 lg:mt-12"
        >
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              Feature comparison between Outly and Buffer, Metricool, Later and Hootsuite, verified on 10 October 2026 from each company&apos;s own pricing and feature pages.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 w-[22%] bg-background pb-5 pr-4 align-bottom">
                  <span className="eyebrow">Feature</span>
                </th>
                <th scope="col" className="w-[18%] rounded-t-[26px] bg-lime/[0.14] dark:bg-lime/[0.06] px-5 pb-5 pt-5 align-bottom shadow-[inset_0_1px_0_hsl(var(--lime)/0.6)]">
                  <span className="flex items-center gap-2 font-display text-[19px] font-bold tracking-tight">
                    <OutlyMark size={22} />
                    Outly
                  </span>
                  <span className="mt-1 block text-[13px] font-normal text-muted-foreground">Beta, free</span>
                </th>
                {COMPETITORS.map((c) => (
                  <th key={c.id} scope="col" className="w-[15%] px-5 pb-5 align-bottom">
                    <span className="block font-display text-[18px] font-semibold tracking-tight">{c.name}</span>
                    <span className="mt-1 block text-[13px] font-normal text-muted-foreground">Checked {c.lastVerified}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROW_GROUPS.map((g, gi) => {
                const rows = ROWS.slice(r, r + g.rows);
                r += g.rows;
                const lastGroup = gi === ROW_GROUPS.length - 1;
                return (
                  <Fragment key={g.label}>
                    <tr>
                      <th scope="colgroup" colSpan={1} className="sticky left-0 z-10 bg-background pb-3 pt-9 text-left">
                        <span className="font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-foreground/70">{g.label}</span>
                      </th>
                      <td className="bg-lime/[0.14] dark:bg-lime/[0.06]" />
                      <td colSpan={cols - 2} />
                    </tr>
                    {rows.map((row, ri) => {
                      const last = lastGroup && ri === rows.length - 1;
                      return (
                        <tr key={row.feature} className="group align-top">
                          <th scope="row" className="sticky left-0 z-10 border-t border-border bg-background py-6 pr-5 transition-colors group-hover:bg-secondary/60">
                            <span className="block font-display text-[16.5px] font-semibold leading-snug tracking-[-0.015em]">{row.feature}</span>
                            {row.detail && <span className="mt-1.5 block text-[13.5px] font-normal leading-snug text-muted-foreground">{row.detail}</span>}
                          </th>
                          <td className={cn("border-t border-lime/25 dark:border-lime/15 bg-lime/[0.14] dark:bg-lime/[0.06] px-5 py-6", last && "rounded-b-[26px]")}>
                            <CellMark value={row.outly.value} note={row.outly.note} />
                          </td>
                          {COMPETITORS.map((c) => {
                            const cell = row.cells[c.id];
                            return (
                              <td key={c.id} className="border-t border-border px-5 py-6 transition-colors group-hover:bg-secondary/40">
                                <CellMark value={cell?.value ?? "unknown"} note={cell?.note} />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </Reveal>

        <p className="mt-8 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">{COMPARISON_DISCLAIMER}</p>

        <Reveal as="ul" stagger className="mt-5 grid gap-3 sm:grid-cols-2">
          {COMPETITORS.map((c) => (
            <li key={c.id} className="rounded-2xl p-4 text-[14px] leading-relaxed text-muted-foreground hairline">
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
            </li>
          ))}
        </Reveal>
      </Shell>
    </section>
  );
}
