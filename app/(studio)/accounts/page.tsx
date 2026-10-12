import { Suspense } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { accountView } from "@/lib/services";
import { canConnectWithToken, hasCredentials } from "@/lib/social/registry";
import { PLATFORMS } from "@/lib/domain";
import { AccountsView, type ConnectSetup } from "@/components/settings/AccountsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connected accounts" };

export default async function AccountsPage() {
  const user = (await getCurrentUser())!;
  if (user.actor) redirect("/home"); // a member never manages the owner's connected accounts
  const accounts = await db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" } } });
  return (
    <Suspense>
      <AccountsView
        initial={accounts.map(accountView)}
        setup={Object.fromEntries(PLATFORMS.map((p) => [p, { oauth: hasCredentials(p), token: canConnectWithToken(p) }])) as ConnectSetup}
      />
    </Suspense>
  );
}
