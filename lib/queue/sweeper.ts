import "server-only";

const g = globalThis as unknown as { __sweeper?: NodeJS.Timeout };

export function startSweeper(intervalMs = 15_000) {
  if (g.__sweeper) return;
  const tick = async () => {
    try {
      const { sweepDuePosts } = await import("./handlers");
      await sweepDuePosts();
      const { maybeSendWeeklyReports } = await import("../reports/weekly");
      await maybeSendWeeklyReports();
    } catch (e) {
      console.error("[sweeper]", e);
    }
  };
  g.__sweeper = setInterval(tick, intervalMs);
  void tick();
}
