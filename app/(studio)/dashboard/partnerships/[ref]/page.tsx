import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getMine } from "@/lib/partners/mine";
import { PartnershipDetail } from "@/components/partnerships/PartnershipDetail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partnership application" };

export default async function PartnershipPage(props: { params: Promise<{ ref: string }> }) {
  const { ref } = await props.params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/dashboard/partnerships/${ref}`)}`);
  // Someone else's application answers exactly like one that does not exist.
  const app = await getMine(user, ref.slice(0, 20));
  if (!app) notFound();
  return <PartnershipDetail app={app} />;
}
