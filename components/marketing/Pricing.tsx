import Link from "next/link";
import { SignupCta } from "./SignupCta";
import { Check } from "lucide-react";
import { Shell, SectionHead } from "./bits";
import { PRICING_NOTE } from "@/lib/marketing/content";
import { inCurrency, listPlans } from "@/lib/billing/plans";
import { visitorCurrency } from "@/lib/billing/visitor";
import { CurrencyPicker } from "@/components/billing/CurrencyPicker";
import { priceLabel } from "@/lib/billing/money";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

/**
 * Reads plans from the database, so a price edited in the admin console is live on the next request.
 * Priced in the visitor's currency (IP country on Vercel/Cloudflare, else browser language, else their pick).
 */
export async function Pricing() {
  const all = await listPlans();
  const visitor = visitorCurrency((all.find((p) => p.priceMinor > 0)?.currency as any) ?? "INR");
  const plans = inCurrency(all, visitor.currency);
  const paid = plans.some((p) => p.state === "available" && p.priceMinor > 0);
  return (
    <section id="pricing" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="pricing-title">
      <Shell>
        <SectionHead
          id="pricing-title"
          align="center"
          eyebrow="Pricing"
          title={paid ? "Simple pricing. Start free." : "Free while we are in beta."}
          body={paid ? "Start on Free and upgrade when you need more. Cancel any time; you keep access until the period ends. Invoices land in your inbox the moment you pay." : PRICING_NOTE}
        />

        {paid && (
          <div className="mt-8 flex justify-center">
            <CurrencyPicker currency={visitor.currency} source={visitor.source} />
          </div>
        )}

        <Reveal as="ul" stagger className={cn("grid gap-4 md:grid-cols-3", paid ? "mt-8" : "mt-14")}>
          {plans.map((p) => {
            const live = p.state === "available";
            const free = p.priceMinor === 0;
            return (
              <li key={p.id}>
                <article
                  className={cn(
                    "flex h-full flex-col rounded-[1.75rem] p-7 sm:p-8",
                    live && (p.highlight || !paid) ? "border-2 border-lime bg-lime/[0.07]" : "border border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-semibold tracking-tight">{p.name}</h3>
                    {!live && (
                      <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </div>
                  <p className={cn("mt-5 text-[1.6rem] font-semibold tracking-tightest", live ? "text-lime-ink" : "text-muted-foreground")}>
                    {priceLabel(p)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>

                  <ul className="mt-7 flex flex-1 flex-col gap-3">
                    {p.features.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[15px] leading-snug">
                        <Check className={cn("mt-0.5 h-4 w-4 shrink-0", live ? "text-lime-ink" : "text-muted-foreground")} aria-hidden="true" />
                        <span className={live ? undefined : "text-muted-foreground"}>{b}</span>
                      </li>
                    ))}
                  </ul>

                  {live && free ? (
                    <SignupCta className="lime-glow mt-8 inline-flex h-12 items-center justify-center rounded-full bg-lime px-6 text-sm font-semibold text-[hsl(var(--lime-foreground))] transition-transform active:scale-[0.97]" />
                  ) : live ? (
                    <Link
                      href={`/billing?plan=${p.slug}`}
                      className="lime-glow mt-8 inline-flex h-12 items-center justify-center rounded-full bg-lime px-6 text-sm font-semibold text-[hsl(var(--lime-foreground))] transition-transform active:scale-[0.97]"
                    >
                      {`Choose ${p.name}`}
                    </Link>
                  ) : (
                    <p className="mt-8 text-[13px] leading-relaxed text-muted-foreground">
                      Not on sale yet. Nothing changes for beta accounts without notice.
                    </p>
                  )}
                </article>
              </li>
            );
          })}
        </Reveal>
      </Shell>
    </section>
  );
}
