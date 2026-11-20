import { z } from "zod";
import { HttpError, json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { processEvent, requeue } from "@/lib/notify-engine";

/**
 * R1267: send a dead letter again. One id answers with what the engine did this time ({ status }); a list is the
 * "Retry all shown" button, at most RETRY_MAX per call and run one after another, so a burst of retries can never
 * hit the push and email providers in parallel.
 */
const RETRY_MAX = 100;
const Id = z.string().trim().min(1).max(64);
const Body = z.union([z.object({ id: Id }), z.object({ ids: z.array(Id).min(1).max(RETRY_MAX, `At most ${RETRY_MAX} at a time.`) })]);

type Outcome = "done" | "retry" | "dead" | "not_found" | "gone";

async function retryOne(id: string, now: Date): Promise<Outcome> {
  const r = await requeue(id, now);
  if (!r.ok) return r.reason;
  return (await processEvent(r.event, now)).status;
}

export const POST = adminRoute(
  "site",
  async (req, { admin }) => {
    const body = Body.parse(await req.json());
    const now = new Date();
    if ("id" in body) {
      const status = await retryOne(body.id, now);
      if (status === "not_found") throw new HttpError(404, "That dead letter is not there any more. Someone may have retried it already.", "NOT_FOUND");
      if (status === "gone") throw new HttpError(409, "The creator this was for no longer has an account, so there is nobody to send it to.", "GONE");
      await adminEvent("notify_retry", "Dead letter retried", `${admin.name} retried a dead letter: ${status === "done" ? "delivered" : status === "retry" ? "failed again, back in the queue" : "given up on again"}.`, "/admin/notifications");
      return json({ status });
    }
    const counts = { total: 0, done: 0, retry: 0, dead: 0, skipped: 0 };
    for (const id of [...new Set(body.ids)]) {
      const s = await retryOne(id, now);
      counts.total++;
      if (s === "done" || s === "retry" || s === "dead") counts[s]++;
      else counts.skipped++;
    }
    await adminEvent("notify_retry", "Dead letters retried", `${admin.name} retried ${counts.total} dead letter${counts.total === 1 ? "" : "s"}: ${counts.done} delivered, ${counts.retry} back in the queue, ${counts.dead} given up on again, ${counts.skipped} skipped.`, "/admin/notifications");
    return json(counts);
  },
  [20, 60_000],
);
