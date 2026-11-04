import type { Metadata } from "next";
import { Shell } from "@/components/marketing/bits";
import { VerifyInvoiceForm } from "@/components/billing/VerifyInvoiceForm";

export const metadata: Metadata = { title: "Verify an invoice", robots: { index: false, follow: false } };

/** 1121: anyone holding an Outlly invoice PDF (an accountant, a client) can check it is genuine and unedited. */
export default async function VerifyInvoicePage(props: { searchParams: Promise<{ n?: string; c?: string }> }) {
  const q = await props.searchParams;
  return (
    <section className="py-16 sm:py-24" aria-labelledby="verify-title">
      <Shell>
        <div className="max-w-xl">
          <p className="eyebrow mb-5">Billing</p>
          <h1 id="verify-title" className="display text-balance text-[clamp(2.2rem,6vw,3.4rem)]">Verify an invoice</h1>
          <p className="mt-6 text-pretty text-[17px] leading-relaxed text-muted-foreground">
            Every Outlly invoice has a verification code at the bottom of the page. Enter it with the invoice number to check the invoice is one we issued
            and that its amount and date haven&apos;t been changed.
          </p>
          <VerifyInvoiceForm number={(q.n ?? "").slice(0, 40)} code={(q.c ?? "").slice(0, 40)} />
        </div>
      </Shell>
    </section>
  );
}
