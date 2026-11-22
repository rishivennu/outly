import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SettingsView } from "@/components/settings/SettingsView";
import { billingSummary } from "@/lib/billing/summary";
import { parseAlertPrefs } from "@/lib/alerts-core";
import { entitlements } from "@/lib/billing/entitlements";
import { hasPerk } from "@/lib/billing/plan-rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/** What Settings > Billing shows (1053): the plan, how checkout can be paid, recent payments and invoices. */
export default async function SettingsPage(props: { searchParams?: Promise<{ tab?: string }> }) {
  const searchParams = await props.searchParams;
  const user = (await getCurrentUser())!;
  // Inside someone else's workspace the profile, email and billing settings are theirs, so they aren't shown.
  // R1223: the three reads run together (they were one after the other), and the profile card's own words come along,
  // so the card shows its handle and bio in the first paint instead of growing under the stats once /api/profile/card
  // answers (0.2 CLS on a phone, measured). The stats still arrive from that request: they ask the platforms.
  const [own, billing, e] = user.actor
    ? [null, null, null]
    : await Promise.all([
        db.user.findUnique({ where: { id: user.id }, select: { weeklyReport: true, alertPrefs: true, handle: true, bio: true, niche: true } }),
        billingSummary(user.id, user.name, user.email),
        // 1096: a switch for something the plan doesn't include would save fine and then never send anything.
        entitlements(user.id).catch(() => null),
      ]);
  const identity = own ? { handle: own.handle, bio: own.bio, niche: own.niche } : null;
  const perks = { digest: !e || hasPerk(e, "weekly-digest"), spike: !e || hasPerk(e, "spike-alerts") };
  return <SettingsView weeklyReport={own?.weeklyReport ?? true} alerts={parseAlertPrefs(own?.alertPrefs)} perks={perks} billing={billing} identity={identity} initialTab={typeof searchParams?.tab === "string" ? searchParams.tab : undefined} />;
}
