import { z } from "zod";
import { json, route } from "@/lib/http";
import { setThreadState } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const stateSchema = z
  .object({ read: z.boolean().optional(), archived: z.boolean().optional() })
  .strict()
  .refine((b) => b.read !== undefined || b.archived !== undefined, { message: "Nothing to change." });

/**
 * Phase 2 (1155): mark a conversation read or unread, archive or restore it. Only Outlly's copy changes:
 * Meta has no API for either, so the person sees nothing and Instagram or Facebook keep their own state.
 */
export const PATCH = route<Ctx>(async (req, { user, params }) => json(await setThreadState(user.id, params.id, stateSchema.parse(await req.json()), user.scope)), { limit: [120, 60_000] });
