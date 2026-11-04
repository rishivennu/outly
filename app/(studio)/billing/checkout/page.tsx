import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MockCheckout } from "@/components/billing/MockCheckout";
import NotFound from "@/app/not-found";

export const dynamic = "force-dynamic";

/**
 * Loaded once per request and shared with generateMetadata, so the title is already "Page not found"
 * by the time the page renders. The page then renders the same not-found screen itself: throwing
 * notFound() here lands after the studio shell has flushed, so React aborts the open boundaries and
 * logs "Minified React error #419" twice in the console while the title stays "Checkout".
 */
const loadPayment = cache(async (id: string | undefined) => {
  const user = await getCurrentUser();
  if (!user) return { user: null, payment: null };
  const p = id ? await db.payment.findUnique({ where: { id }, include: { invoice: true } }) : null;
  return { user, payment: p && p.userId === user.id && p.provider === "mock" ? p : null };
});

export async function generateMetadata(props: { searchParams: Promise<{ p?: string }> }) {
  const { p: id } = await props.searchParams;
  const { user, payment } = await loadPayment(id);
  return { title: user && !payment ? "Page not found" : "Checkout", robots: { index: false, follow: false } };
}

/** The mock gateway's hosted page. Real gateways never land here. */
export default async function CheckoutPage(props: { searchParams: Promise<{ p?: string }> }) {
  const searchParams = await props.searchParams;
  const { user, payment: p } = await loadPayment(searchParams.p);
  if (!user) redirect("/api/auth/expired?next=/billing");
  if (!p) return <NotFound />;
  if (p.status === "succeeded") redirect(`/billing?paid=${p.invoice?.number ?? ""}`);
  const plan = p.planId ? await db.plan.findUnique({ where: { id: p.planId } }) : null;
  return <MockCheckout paymentId={p.id} amountMinor={p.amountMinor} currency={p.currency} planName={plan?.name ?? "Outlly"} interval={plan?.interval ?? "month"} email={user.email} />;
}
