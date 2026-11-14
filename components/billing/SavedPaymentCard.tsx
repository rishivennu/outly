"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";
import type { CardNetwork, SavedCard } from "@/lib/billing/saved-cards-core";

/**
 * 1118: one saved card, drawn like a real card. Black body, lime gradient panel with an organic curve.
 * Everything on it is the masked view Razorpay returns: network, last 4, expiry, type. No card number exists here.
 */
const TYPE: Record<string, string> = { credit: "Credit", debit: "Debit", prepaid: "Prepaid" };

export function cardLabel(c: Pick<SavedCard, "networkLabel" | "type" | "last4" | "expiry" | "isDefault" | "expired">) {
  return [`${c.networkLabel}${c.type ? ` ${TYPE[c.type].toLowerCase()}` : ""} card ending ${c.last4}`, c.expiry ? `${c.expired ? "expired" : "expires"} ${c.expiry}` : null, c.isDefault ? "default" : null].filter(Boolean).join(", ");
}

export function SavedPaymentCard({ card, className }: { card: SavedCard; className?: string }) {
  const gid = useId().replace(/:/g, "");
  return (
    <article aria-label={cardLabel(card)} className={cn("spc relative isolate aspect-[1.586] w-full max-w-[360px] overflow-hidden rounded-[22px] text-white", card.expired && "spc-expired", className)}>
      <svg className="absolute inset-0 -z-10 h-full w-full" viewBox="0 0 320 202" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#B5FF00" />
            <stop offset=".55" stopColor="#80E000" />
            <stop offset="1" stopColor="#37A900" />
          </linearGradient>
        </defs>
        <rect width="320" height="202" fill="#050505" />
        <path d="M0 0H320V70C286 92 254 64 214 76C170 90 140 116 92 108C56 102 28 90 0 98Z" fill={`url(#g${gid})`} />
        <path d="M0 98C28 90 56 102 92 108C140 116 170 90 214 76C254 64 286 92 320 70V78C288 100 256 74 216 85C172 98 142 125 92 117C56 111 28 99 0 107Z" fill="#37A900" opacity=".35" />
      </svg>

      <div className="flex h-full flex-col p-[7%]" aria-hidden="true">
        <div className="flex items-start justify-between gap-3 text-[#050505]">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em]">SAVED PAYMENT METHOD</p>
            <p className="mt-1 truncate text-[15px] font-semibold leading-tight">{card.issuer ?? card.networkLabel}</p>
          </div>
          {card.isDefault && <span className="shrink-0 rounded-full bg-[#050505] px-2.5 py-1 text-xs font-semibold text-[#B5FF00]">Default</span>}
          {card.expired && <span className="shrink-0 rounded-full bg-[#050505] px-2.5 py-1 text-xs font-semibold text-[#FFB4A8]">Expired</span>}
        </div>

        <p className="tabular mt-auto font-mono text-[clamp(15px,5.4cqw,19px)] tracking-[0.12em]">
          <span className="text-[#A5A5A5]">•••• •••• ••••</span> {card.last4}
        </p>

        <div className="mt-[6%] flex items-end justify-between gap-3">
          <div className="flex gap-6">
            <div>
              <p className="text-[9.5px] font-medium tracking-[0.14em] text-[#A5A5A5]">EXPIRES</p>
              <p className="tabular mt-0.5 text-[13.5px] font-medium">{card.expiry ?? "--/--"}</p>
            </div>
            {card.type && (
              <div>
                <p className="text-[9.5px] font-medium tracking-[0.14em] text-[#A5A5A5]">TYPE</p>
                <p className="mt-0.5 text-[13.5px] font-medium">{TYPE[card.type]}</p>
              </div>
            )}
          </div>
          <NetworkMark network={card.network} label={card.networkLabel} />
        </div>
      </div>
    </article>
  );
}

/** Simple, legible network marks drawn for a black background. */
export function NetworkMark({ network, label }: { network: CardNetwork; label: string }) {
  if (network === "mastercard" || network === "maestro")
    return (
      <svg viewBox="0 0 48 30" className="h-7 w-auto shrink-0" aria-hidden="true">
        <circle cx="17" cy="15" r="13" fill={network === "maestro" ? "#0099DF" : "#EB001B"} />
        <circle cx="31" cy="15" r="13" fill={network === "maestro" ? "#ED0006" : "#F79E1B"} />
        <path d="M24 4.2a13 13 0 0 1 0 21.6a13 13 0 0 1 0-21.6Z" fill={network === "maestro" ? "#6C6BBD" : "#FF5F00"} />
      </svg>
    );
  if (network === "visa") return <span className="shrink-0 text-[22px] font-black italic leading-none tracking-tight" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>VISA</span>;
  if (network === "rupay")
    return (
      <span className="shrink-0 text-[17px] font-black italic leading-none" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        Ru<span className="text-[#F7941D]">Pay</span>
      </span>
    );
  if (network === "amex") return <span className="shrink-0 rounded-[4px] bg-[#2E77BC] px-1.5 py-1 text-xs font-black leading-none tracking-wide">AMEX</span>;
  return <span className="shrink-0 text-[13px] font-semibold text-[#A5A5A5]">{label}</span>;
}
