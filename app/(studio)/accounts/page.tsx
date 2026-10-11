import { Suspense } from "react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { accountView } from "@/lib/services";
import { canConnectWithToken, hasCredentials, practiceAllowed } from "@/lib/social/registry";
import { PLATFORMS } from "@/lib/domain";
import { AccountsView, type ConnectSetup } from "@/components/settings/AccountsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connected accounts" };

export default async function AccountsPage() {
  const user = (await getCurrentUser())!;
  const accounts = await db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" } } });
  return (
    <Suspense>
      <AccountsView
        initial={accounts.map(accountView)}
        mock={practiceAllowed()}
        setup={Object.fromEntries(PLATFORMS.map((p) => [p, { oauth: hasCredentials(p), token: canConnectWithToken(p) }])) as ConnectSetup}
      />
    </Suspense>
  );
}
