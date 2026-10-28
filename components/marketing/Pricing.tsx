import { PricingCards, type CardPlan } from "./PricingCards";
import { Shell, SectionHead } from "./bits";
import { PRICING_NOTE } from "@/lib/marketing/content";
import { isBeta } from "@/lib/beta";
import { inCurrency, listPlans } from "@/lib/billing/plans";
import { getConfig } from "@/lib/settings";
import { normalizeDisplay } from "@/lib/billing/display";
import { hasYearly, priceFor, yearlySaving } from "@/lib/billing/cycle";
import { visitorCurrency } from "@/lib/billing/visitor";
import { CurrencyPicker } from "@/components/billing/CurrencyPicker";
import { formatMoney, planFeatures, priceLabel } from "@/lib/billing/money";

/**
 * Reads plans from the database, so a price edited in the admin console is live on the next request.
 * Priced in the visitor's currency (IP country on Vercel/Cloudflare, else browser language, else their pick).
 */
export async function Pricing() {
  const [all, display, beta] = await Promise.all([listPlans(), getConfig("pricing").then(normalizeDisplay), isBeta()]);
  const visitor = visitorCurrency((all.find((p) => p.priceMinor > 0)?.currency as any) ?? "INR");
  const plans = inCurrency(all, visitor.currency);
  const paid = plans.some((p) => p.state === "available" && p.priceMinor > 0);
  const cards: CardPlan[] = plans.map((p, i) => {
    const base = all[i];
    const y = hasYearly(base, display.yearly) ? priceFor(base, visitor.currency, "year", display.freeMonths) : null;
    return {
      id: p.id, slug: p.slug, name: p.name, note: p.note, features: planFeatures(p), state: p.state,
      featured: p.highlight || !paid,
      free: p.priceMinor === 0,
      month: { label: priceLabel(p), minor: p.priceMinor, interval: p.interval },
      year: y ? { label: `${formatMoney(y.priceMinor, y.currency)}/yr`, minor: y.priceMinor, save: yearlySaving(p.priceMinor, y.priceMinor) } : null,
    };
  });
  return (
    <section id="pricing" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="pricing-title">
      <Shell>
        <SectionHead
          id="pricing-title"
          align="center"
          eyebrow="Pricing"
          title={paid ? "Simple pricing. Start free." : beta ? "Free while we are in beta." : "Start free."}
          body={paid ? "Start on Free and upgrade when you need more. Cancel any time; you keep access until the period ends. Invoices land in your inbox the moment you pay." : PRICING_NOTE}
        />

        {paid && (
          <div className="mt-8 flex justify-center">
            <CurrencyPicker currency={visitor.currency} source={visitor.source} />
          </div>
        )}

        <PricingCards plans={cards} variant={display.cardStyle} top={paid ? "mt-8" : "mt-14"} />
      </Shell>
    </section>
  );
}
