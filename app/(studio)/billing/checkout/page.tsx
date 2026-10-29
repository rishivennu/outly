import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MockCheckout } from "@/components/billing/MockCheckout";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout" };

/** The mock gateway's hosted page. Real gateways never land here. */
export default async function CheckoutPage({ searchParams }: { searchParams: { p?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/expired?next=/billing");
  const p = searchParams.p ? await db.payment.findUnique({ where: { id: searchParams.p }, include: { invoice: true } }) : null;
  if (!p || p.userId !== user.id || p.provider !== "mock") notFound();
  if (p.status === "succeeded") redirect(`/billing?paid=${p.invoice?.number ?? ""}`);
  const plan = p.planId ? await db.plan.findUnique({ where: { id: p.planId } }) : null;
  return <MockCheckout paymentId={p.id} amountMinor={p.amountMinor} currency={p.currency} planName={plan?.name ?? "Outlly"} interval={plan?.interval ?? "month"} email={user.email} />;
}
