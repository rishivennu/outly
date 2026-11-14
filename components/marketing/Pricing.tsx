import { PricingCards, type CardPlan } from "./PricingCards";
import { Shell, SectionHead } from "./bits";
import { Reveal } from "./Reveal";
import { PRICING_NOTE } from "@/lib/marketing/content";
import { isBeta } from "@/lib/beta";
import { inCurrency, listPlans } from "@/lib/billing/plans";
import { getConfig } from "@/lib/settings";
import { normalizeDisplay } from "@/lib/billing/display";
import { hasYearly, priceFor, yearlySaving } from "@/lib/billing/cycle";
import { visitorCurrency } from "@/lib/billing/visitor";
import { activeGateway } from "@/lib/billing/service";
import { chargeCurrency } from "@/lib/billing/currency";
import { CurrencyNote } from "@/components/billing/CurrencyNote";
import { formatMoney, planFeatures, priceLabel, type Currency } from "@/lib/billing/money";
import { floorMinor, getEconomics, getPolicy, yearlyFromMonthly } from "@/lib/subscriptions";
import { introThen } from "@/components/billing/offer-core";

/**
 * Reads plans from the database, so a price edited in the admin console is live on the next request.
 * Priced in the visitor's currency (IP country on Vercel/Cloudflare, else browser language, else their pick).
 */
export async function Pricing() {
  const [all, display, beta, gw, policy, econ] = await Promise.all([listPlans(), getConfig("pricing").then(normalizeDisplay), isBeta(), activeGateway(), getPolicy(), getEconomics()]);
  const visitor = await visitorCurrency((all.find((p) => p.priceMinor > 0)?.currency as any) ?? "INR");
  // Priced in what the gateway can actually charge, exactly as Billing and checkout do, so the two pages agree.
  const charged = chargeCurrency(gw.provider, visitor.currency, all.find((p) => p.priceMinor > 0)?.currency ?? "INR");
  const plans = inCurrency(all, charged);
  const paid = plans.some((p) => p.state === "available" && p.priceMinor > 0);
  const cards: CardPlan[] = plans.map((p, i) => {
    const base = all[i];
    const y0 = hasYearly(base, display.yearly) ? priceFor(base, charged, "year", display.freeMonths) : null;
    // 1147: with the policy on, a visitor sees the first-time price and what returning subscribers pay, from the
    // same policy checkout quotes from. A yearly price is never under its 60% floor.
    const on = policy.enabled && p.state === "available" && p.priceMinor > 0 && p.interval !== "year";
    const target = policy.targetMargin;
    const y = y0 && on ? { ...y0, priceMinor: Math.max(y0.priceMinor, floorMinor({ plan: p.slug, currency: y0.currency, interval: "year", econ, target })) } : y0;
    const im = on ? policy.intro[p.slug]?.[charged as Currency] : undefined;
    const introM = im && im > 0 && im < p.priceMinor ? im : null;
    const introY = introM && y ? Math.min(y.priceMinor, yearlyFromMonthly({ plan: p.slug, currency: y.currency, monthlyMinor: introM, econ, target })) : null;
    return {
      id: p.id, slug: p.slug, name: p.name, note: p.note, features: planFeatures(p), state: p.state,
      featured: p.highlight || !paid,
      free: p.priceMinor === 0,
      month: { label: priceLabel(p), minor: p.priceMinor, interval: p.interval },
      year: y
        ? {
            label: `${formatMoney(y.priceMinor, y.currency)}/yr`, minor: y.priceMinor, save: yearlySaving(p.priceMinor, y.priceMinor),
            intro: introY && introY < y.priceMinor ? { label: `${formatMoney(introY, y.currency)}/yr`, minor: introY, then: introThen(y.priceMinor, y.currency, "year", policy.graceDays) } : null,
          }
        : null,
      intro: introM ? { label: `${formatMoney(introM, charged)}/mo`, minor: introM, then: introThen(p.priceMinor, charged, "month", policy.graceDays) } : null,
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
          body={paid ? "Start on Free and upgrade when you need more. Your first payment comes with a 30-day money-back guarantee you claim yourself from Billing, and nothing renews on its own. Invoices land in your inbox the moment you pay." : PRICING_NOTE}
        />

        {paid && (
          <Reveal y={16} className="mt-8 flex justify-center">
            <CurrencyNote currency={charged} wanted={visitor.currency} source={visitor.source} />
          </Reveal>
        )}

        <PricingCards plans={cards} variant={display.cardStyle} top={paid ? "mt-8" : "mt-14"} />
      </Shell>
    </section>
  );
}
