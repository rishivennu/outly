import { Globe2 } from "lucide-react";
import { CURRENCY_NAME, type CurrencySource } from "@/lib/billing/currency";
import { cn } from "@/lib/utils";

/**
 * "Prices in INR (Indian rupee)". Read-only: the currency follows location on every page. 1142: the user asked for
 * the "based on your location" line to go (billing and the landing page), so only a forced currency says why.
 * `source` stays in the props so callers don't change.
 * `wanted` is the visitor's own currency: when the gateway cannot charge it, the note names the one that is
 * charged instead, so the pill and the prices on the cards never disagree.
 */
export function CurrencyNote({ currency, wanted, className }: { currency: string; source: CurrencySource; wanted?: string; className?: string }) {
  const name = (CURRENCY_NAME as Record<string, string>)[currency];
  const forced = !!wanted && wanted !== currency;
  const why = forced ? "what our payment provider charges" : null;
  return (
    <p className={cn("inline-flex items-center gap-2 rounded-full bg-secondary/60 px-3 py-1.5 text-[13px] text-muted-foreground hairline", className)}>
      <Globe2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Prices in <b className="font-semibold text-foreground">{currency}</b>
        {name ? ` (${name})` : ""}
        {why ? `, ${why}` : ""}
      </span>
    </p>
  );
}
