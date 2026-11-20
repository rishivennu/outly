"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { Card, CardTitle } from "@/components/admin/ui";

const CODE_STATUSES = ["offer_accepted", "active", "completed"];

/** Visits, signups and paid conversions tracked from the creator's referral link. */
export default function AttributionCard({ id, status, code, counts }: { id: string; status: string; code: string | null; counts: { visits: number; signups: number; paid: number } }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const link = code ? `https://outlly.com/?ref=${code}` : "";

  async function create() {
    setBusy(true);
    try {
      await adminApi(`/api/admin/partners/${id}/code`, { method: "POST", json: {} });
      toast("Referral code created.");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle hint="Tracked from the creator's link. Consent-respecting, so it may undercount.">Attribution</CardTitle>
      <dl className="grid grid-cols-3 gap-3">
        {([["Visits", counts.visits], ["Signups", counts.signups], ["Paid", counts.paid]] as const).map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-secondary/50 p-3">
            <dt className="text-[12px] font-semibold text-muted-foreground">{k}</dt>
            <dd className="mt-1 font-display text-[1.4rem] font-bold leading-none tabular-nums">{v.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        {code ? (
          <div className="flex items-center gap-2 rounded-2xl bg-secondary/40 py-1 pl-3.5 pr-1">
            <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">Link</span>
            <code className="min-w-0 flex-1 truncate text-[13px]" title={link}>{link}</code>
            <Button type="button" variant="ghost" size="icon" aria-label="Copy referral link" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Link copied."), () => toast("Couldn't copy. Select the link and copy it.", "error"))}>
              <Copy className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ) : CODE_STATUSES.includes(status) ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-muted-foreground">No referral code yet.</p>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create referral code"}</Button>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">A referral code is created once the creator accepts an offer.</p>
        )}
      </div>
    </Card>
  );
}
