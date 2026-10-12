"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe2, Loader2 } from "lucide-react";
import { CURRENCIES } from "@/lib/billing/money";
import { CURRENCY_COOKIE, CURRENCY_NAME, type CurrencySource } from "@/lib/billing/currency";
import { cn } from "@/lib/utils";

/** "Prices in USD (based on your location)". Changing it saves a cookie, so every page and checkout agree. */
export function CurrencyPicker({ currency, source, className }: { currency: string; source: CurrencySource; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const why = source === "choice" ? "your choice" : source === "default" ? "default" : "based on your location";

  function change(v: string) {
    document.cookie = v === "auto" ? `${CURRENCY_COOKIE}=; path=/; max-age=0; samesite=lax` : `${CURRENCY_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  }

  return (
    <div className={cn("inline-flex items-center gap-2 rounded-full bg-secondary/60 py-1 pl-3 pr-1 text-[13px] hairline", className)}>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden /> : <Globe2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      <label htmlFor="ccy-pick" className="text-muted-foreground">
        Prices in <span className="sr-only">(currently {currency}, {why})</span>
      </label>
      <select
        id="ccy-pick"
        value={currency}
        onChange={(e) => change(e.target.value)}
        className="h-8 cursor-pointer rounded-full bg-background px-2.5 text-[13px] font-semibold hairline"
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>{c} · {CURRENCY_NAME[c]}</option>
        ))}
        {source === "choice" && <option value="auto">Use my location</option>}
      </select>
      <span className="hidden pr-2 text-[12px] text-muted-foreground sm:inline" aria-hidden>{why}</span>
    </div>
  );
}
