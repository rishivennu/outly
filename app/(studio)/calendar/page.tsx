import { getCurrentUser } from "@/lib/auth";
import { accountStates, loadRangePage, loadUnscheduled } from "@/lib/calendar/load";
import { rangeOf, visibleDays } from "@/lib/calendar/range";
import { dayKey } from "@/lib/client/tz";
import { CalendarView } from "@/components/calendar/CalendarView";
import { PageFresh } from "@/components/shell/PageFresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

/** P2: only the week on screen (and the first undated drafts); other views and pages load their own range. */
export default async function CalendarPage() {
  const user = (await getCurrentUser())!;
  const today = dayKey(new Date(), user.timezone);
  const days = visibleDays("week", today);
  const { from, to } = rangeOf(days, user.timezone);
  const [{ posts, truncated }, drafts, accounts] = await Promise.all([loadRangePage(user, from, to), loadUnscheduled(user), accountStates(user.id, user.scope)]);
  // 1114: may open from the background preload; brings itself up to date when that copy is 2 minutes old.
  return (
    <>
      <PageFresh renderedAt={Date.now()} maxAge={120_000} />
      <CalendarView initial={posts} loaded={[+from, +to]} drafts={drafts} accounts={accounts} truncated={truncated} />
    </>
  );
}
