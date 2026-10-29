import { Globe2 } from "lucide-react";
import { CURRENCY_NAME, type CurrencySource } from "@/lib/billing/currency";
import { cn } from "@/lib/utils";

/** "Prices in INR (Indian rupee), based on your location". Read-only: the currency follows location on every page. */
export function CurrencyNote({ currency, source, className }: { currency: string; source: CurrencySource; className?: string }) {
  const name = (CURRENCY_NAME as Record<string, string>)[currency];
  const why = source === "default" ? "our default" : "based on your location";
  return (
    <p className={cn("inline-flex items-center gap-2 rounded-full bg-secondary/60 px-3 py-1.5 text-[13px] text-muted-foreground hairline", className)}>
      <Globe2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Prices in <b className="font-semibold text-foreground">{currency}</b>
        {name ? ` (${name})` : ""}, {why}
      </span>
    </p>
  );
}
