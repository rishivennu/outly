import { hasCredentials, loadKeys } from "@/lib/social/registry";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthFormSkeleton } from "@/components/auth/AuthFormSkeleton";
import { foundingPublic } from "@/lib/founding";
import { FoundingSeats } from "@/components/founding/FoundingSeats";
import { ReferralInvite } from "@/components/auth/ReferralInvite";
import { isCode } from "@/lib/referral-core";
import { referralConfig } from "@/lib/referral";
import { db } from "@/lib/db";
import { whatsappAvailable } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your account" };

/** A share link (?ref=CODE, 1052) shows what the invite is worth, when the code is real and Refer & Earn is on. */
async function invite(ref: string | undefined) {
  const code = ref?.toLowerCase();
  if (!isCode(code)) return null;
  try {
    const [cfg, owner] = await Promise.all([referralConfig(), db.user.findUnique({ where: { referralCode: code }, select: { id: true } })]);
    if (!cfg.enabled || !owner) return null;
    const plan = await db.plan.findUnique({ where: { slug: cfg.rewardPlan }, select: { name: true } });
    return { plan: plan?.name ?? "Creator", days: cfg.rewardDays };
  } catch {
    return null;
  }
}

export default async function SignupPage({ searchParams }: { searchParams: { ref?: string } }) {
  const [, seats, inv, whatsapp] = await Promise.all([loadKeys(), foundingPublic(), invite(searchParams.ref), whatsappAvailable().catch(() => false)]);
  const banner = seats || inv ? <>{inv && <ReferralInvite plan={inv.plan} days={inv.days} />}{seats && <FoundingSeats initial={seats} />}</> : null;
  return (
    <Suspense fallback={<AuthFormSkeleton fields={3} />}>
      <AuthForm mode="signup" google={hasCredentials("youtube")} whatsapp={whatsapp} title="Create an account" subtitle="Upload once, post everywhere. Takes ten seconds." banner={banner} />
    </Suspense>
  );
}
