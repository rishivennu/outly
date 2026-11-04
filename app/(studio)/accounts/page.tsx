import { Suspense } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { accountView } from "@/lib/services";
import { entitlements } from "@/lib/billing/entitlements";
import { canConnectWithToken, hasCredentials, practiceAllowed } from "@/lib/social/registry";
import { isPlatform, PLATFORMS, type Platform } from "@/lib/domain";
import { AccountsView, type ConnectSetup } from "@/components/settings/AccountsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connected accounts" };

export default async function AccountsPage() {
  const user = (await getCurrentUser())!;
  if (user.actor) redirect("/home"); // a member never manages the owner's connected accounts
  const [accounts, previous, ent] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" } }, orderBy: { createdAt: "asc" } }),
    // 1095: disconnected accounts, by name only, so the page can offer to reconnect them.
    db.socialAccount.findMany({ where: { userId: user.id, status: "disconnected" }, orderBy: { updatedAt: "asc" }, select: { id: true, platform: true, username: true } }),
    entitlements(user.id),
  ]);
  return (
    <Suspense>
      <AccountsView
        initial={accounts.map(accountView)}
        previous={previous.filter((a): a is typeof a & { platform: Platform } => isPlatform(a.platform))}
        accountLimit={ent.accountLimit > 0 ? ent.accountLimit : ent.brandLimit + ent.extraBrands > 1 ? (ent.brandLimit + ent.extraBrands) * PLATFORMS.length : 0}
        brands={ent.brandLimit > 0 ? ent.brandLimit + ent.extraBrands : 0}
        platformLimit={ent.platformLimit}
        setup={Object.fromEntries(PLATFORMS.map((p) => [p, { oauth: hasCredentials(p), token: canConnectWithToken(p), practice: practiceAllowed() }])) as ConnectSetup}
      />
    </Suspense>
  );
}
