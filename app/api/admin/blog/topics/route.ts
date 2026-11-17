import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { JobError } from "@/lib/blog/job";
import { addBacklogTopic, backlogTopics, removeBacklogTopic } from "@/lib/blog/calendar";

export const dynamic = "force-dynamic";

const wrap = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof JobError) throw new HttpError(e.status, e.message, "JOB");
    throw e;
  }
};

/** R1178: the topic backlog the scheduled run draws from, plus runner-ups worth queueing. */
export const GET = adminRoute("content", async () => json(await backlogTopics()));

const Add = z.union([
  z.object({ fromId: z.string().trim().min(1).max(40) }),
  z.object({ topic: z.string().trim().min(1, "Write the topic first.").max(200), problem: z.string().trim().max(400).optional(), primaryKeyword: z.string().trim().max(80).optional(), category: z.string().trim().max(60).optional() }),
]);

export const POST = adminRoute("content", async (req) => {
  const b = Add.parse(await req.json());
  return json({ topic: await wrap(() => addBacklogTopic(b)) }, { status: 201 });
}, [30, 60_000]);

export const DELETE = adminRoute("content", async (req) => {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) throw new HttpError(400, "Which topic? Pass ?id=", "VALIDATION");
  await wrap(() => removeBacklogTopic(id));
  return json({ ok: true });
}, [30, 60_000]);
