import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listMine } from "@/lib/partners/mine";
import { PartnershipsList, SummaryCards } from "@/components/partnerships/PartnershipsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Partnerships" };

export default async function PartnershipsPage(props: { searchParams: Promise<{ new?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/partnerships");
  const [{ apps, summary }, sp] = await Promise.all([listMine(user), props.searchParams]);
  const fresh = typeof sp.new === "string" ? sp.new.slice(0, 20) : null;
  return (
    <div className="page-frame pb-20 pt-6 lg:pt-10">
      <header className="max-w-2xl">
        <h1 className="display text-[clamp(1.9rem,4.5vw,2.8rem)] leading-tight">Your Creator Partnerships</h1>
        <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted-foreground">Track your applications, review partnership offers, and manage your collaborations with Outlly.</p>
      </header>
      <div className="mt-6">
        <SummaryCards summary={summary} />
      </div>
      <div className="mt-6">
        <PartnershipsList apps={apps} fresh={fresh} />
      </div>
    </div>
  );
}
