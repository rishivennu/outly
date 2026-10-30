import { z } from "zod";
import { json, route } from "@/lib/http";
import { deletionStatus } from "@/lib/account-cleanup";
import { deletionMessage } from "@/lib/account-cleanup-core";

export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().min(20).max(100) });

/**
 * Public, because the account it reports on no longer exists (1053). The token is the only key: it is sent
 * in the body (never the URL) and matched by hash. An unknown token gets a 404 that says nothing more.
 */
export const POST = route(
  async (req) => {
    const { token } = Body.parse(await req.json());
    const v = await deletionStatus(token);
    if (!v) return json({ error: "That status link has expired or isn't right.", code: "NOT_FOUND" }, { status: 404 });
    return json({ ...v, message: deletionMessage(v) }, { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [30, 60_000] },
);
