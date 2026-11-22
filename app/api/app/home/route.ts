import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { soft } from "@/lib/budget";
import { connectedPlatforms } from "@/lib/live/connected";
import { isPlatform, type Platform } from "@/lib/domain";
import { homeRetention } from "@/lib/retention/home";
import { homePulse } from "@/lib/retention/pulse";
import { lastWeekRecap } from "@/lib/reports/weekly";
import { savedTime } from "@/lib/retention/time-saved";
import { trustBadges } from "@/lib/badges";
import { myFounding } from "@/lib/founding";
import { postFilter } from "@/lib/profiles";
import { entitlements } from "@/lib/billing/entitlements";
import { hasPerk } from "@/lib/billing/plan-rules";

export const dynamic = "force-dynamic";
const CARD_MS = 1500;

/**
 * R-APP6: the classic Home cards the web page renders on the server (app/(studio)/home/page.tsx classicView),
 * for the native app in one call: what to do next, weekly goal + streak, recycle picks, this week's pulse,
 * last week's recap, time saved, trust badges and the founding promo. Each part is read by the same lib
 * function the page uses and degrades alone (soft budget), so the card set never drifts from the web.
 * `?recapHidden=<key>` mirrors the web's hide cookie (the app stores the key itself).
 */
export const GET = route(async (req, { user }) => {
  const now = new Date();
  const recapHidden = req.nextUrl.searchParams.get("recapHidden");
  const liveP = connectedPlatforms(user.id);
  const publishedP = db.post.count({ where: { userId: user.id, status: { in: ["published", "partial"] } } });
  const meP = db.user.findUnique({ where: { id: user.id }, select: { postingGoal: true, weeklyReport: true } });
  const digestP = user.actor ? Promise.resolve(false) : entitlements(user.id).then((e) => hasPerk(e, "weekly-digest")).catch(() => true);
  const scope = await postFilter(user);
  const [live, published, ret, pulse, recap, founding, saved, badges, canEmail] = await Promise.all([
    liveP,
    publishedP,
    soft(meP.then((me) => homeRetention({ id: user.id, postingGoal: me?.postingGoal ?? 3, timezone: user.timezone }, now)), CARD_MS, null, "app home retention"),
    soft(
      Promise.all([liveP, publishedP]).then(([lv, pub]) =>
        Object.values(lv).some(Boolean) || pub > 0 ? homePulse({ id: user.id, timezone: user.timezone }, Object.keys(lv).filter((k) => lv[k as Platform] && isPlatform(k)) as Platform[], now) : null,
      ),
      CARD_MS,
      null,
      "app home pulse",
    ),
    soft(
      meP
        .then((me) => lastWeekRecap({ id: user.id, timezone: user.timezone, postingGoal: me?.postingGoal ?? 3, weeklyReport: me?.weeklyReport ?? true }, now))
        .then((r) => (r && r.key === recapHidden ? null : r)),
      CARD_MS,
      null,
      "app home recap",
    ),
    user.actor ? null : soft(myFounding(user.id), CARD_MS, null, "app home founding"),
    soft(savedTime(user.id, now.getTime(), scope.where), CARD_MS, null, "app home saved"),
    soft(trustBadges(user.id), CARD_MS, null, "app home badges"),
    digestP,
  ]);
  const started = Object.values(live).some(Boolean) || published > 0;
  return json(
    {
      started,
      published,
      live,
      steps: ret?.steps ?? [],
      goal: ret?.goal ?? null,
      recycle: ret?.recycle ?? [],
      ideasCount: ret?.ideas ?? 0,
      scheduledThisWeek: ret?.scheduledThisWeek ?? 0,
      pulse,
      recap: recap ? { ...recap, canEmail } : null,
      saved,
      badges,
      founding,
      owner: !user.actor,
      serverTime: now.toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
});
