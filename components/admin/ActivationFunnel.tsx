"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Activation, Person } from "@/lib/admin/activation";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Hint } from "./ui";
import { pct } from "./behavior-fmt";

const n = (v: number) => v.toLocaleString("en-IN");

function People({ title, people, total, limit, empty }: { title: string; people: Person[]; total: number; limit: number; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">
        {title} <span className="font-normal">({total > limit ? `newest ${people.length} of ${n(total)}` : n(total)})</span>
      </p>
      {people.length ? (
        <ul className="flex flex-col gap-1 text-[13px]">
          {people.map((p) => (
            <li key={p.id} className="min-w-0">
              <a href={`/admin/users?q=${encodeURIComponent(p.email.includes("*") ? p.name : p.email)}`} className="inline-flex min-h-8 max-w-full items-baseline gap-2 rounded-md underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:underline">
                <span className="truncate font-medium">{p.name || "No name"}</span>
                <span className="truncate text-[12px] text-muted-foreground">{p.email}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

/**
 * 1166: the activation funnel. One cohort at a time, every step the same people, later steps never larger.
 * Each step opens to show who reached it and who stopped just before it (names only for roles that may open user
 * records; the server leaves the lists out for everyone else).
 */
export function ActivationFunnel({ a, rangeDays }: { a: Activation; rangeDays: number }) {
  const [which, setWhich] = useState<"range" | "all">("range");
  const f = a[which];
  const start = f.steps[0].count;
  return (
    <Card className="gs-in">
      <CardTitle
        hint={`${f.label}${f.from ? ", UTC days" : ""}. Each step counts the people who also did every step before it, at any time up to now.`}
        action={
          <div role="radiogroup" aria-label="Funnel cohort" className="inline-flex shrink-0 rounded-full bg-secondary/70 p-1">
            {(["range", "all"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={which === k} onClick={() => setWhich(k)} className={cn("min-h-11 rounded-full px-3 text-[12.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", which === k ? "lime-bg" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}>
                {k === "range" ? `Joined in ${rangeDays} days` : "All accounts"}
              </button>
            ))}
          </div>
        }
      >
        Activation funnel
      </CardTitle>

      {start === 0 ? (
        <p className="rounded-2xl bg-secondary/50 px-4 py-3 text-[13.5px] text-muted-foreground">Nobody signed up in this range, so there is no cohort to follow. Switch to All accounts to see everyone.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {f.steps.map((s, i) => (
            <li key={s.key}>
              <details className="group rounded-2xl px-1 [&[open]]:bg-secondary/40">
                <summary className="flex min-h-11 cursor-pointer list-none flex-col gap-1.5 rounded-2xl px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13.5px]">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                      {i + 1}. {s.label}
                    </span>
                    <span className="tabular text-muted-foreground">
                      <b className="text-foreground">{n(s.count)}</b> · {pct(s.pctOfStart)} of step 1
                      {s.stepRate !== null && <> · {pct(s.stepRate)} of step {i}</>}
                    </span>
                  </span>
                  <span className="block h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden>
                    <span className="gs-bar block h-full rounded-full bg-lime" style={{ width: `${Math.max(s.pctOfStart * 100, s.count ? 1.5 : 0)}%` }} />
                  </span>
                  {(s.dropped > 0 || s.skipped > 0) && (
                    <span className="text-[12.5px] text-muted-foreground">
                      {s.dropped > 0 && <>{n(s.dropped)} stopped before this step</>}
                      {s.dropped > 0 && s.skipped > 0 && " · "}
                      {s.skipped > 0 && <>{n(s.skipped)} did it but skipped an earlier step, so are not counted here</>}
                    </span>
                  )}
                </summary>
                <div className="px-2 pb-3 pt-1">
                  <p className="mb-3 text-[12.5px] text-muted-foreground">{s.rule}</p>
                  {a.peopleShown ? (
                    <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                      <People title="Reached this step" people={s.reached} total={s.count} limit={a.peopleLimit} empty="Nobody yet." />
                      {i > 0 && <People title="Stopped just before it" people={s.stopped} total={s.dropped} limit={a.peopleLimit} empty="Nobody stopped here." />}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-muted-foreground">Your role can see the counts but not who is in each step.</p>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 rounded-2xl bg-secondary/50 px-4 py-3 text-[13px]">
        <p className="flex items-center gap-1 font-semibold">
          Waitlist, counted on its own
          <Hint text="The waitlist is a separate list. People can sign up without joining it, and many who join never sign up, so it is not step 1 of the funnel. Matched to accounts by email." label="Why the waitlist is separate" />
        </p>
        <p className="mt-1 tabular text-muted-foreground">
          <b className="text-foreground">{n(a.waitlist.joined)}</b> joined in the last {rangeDays} days · <b className="text-foreground">{n(a.waitlist.withAccount)}</b> of them have an account · <b className="text-foreground">{n(a.waitlist.inCohort)}</b> signed up in the same {rangeDays} days
        </p>
      </div>
    </Card>
  );
}
