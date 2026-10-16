import { exportUser } from "@/lib/account";
import { route } from "@/lib/http";
import { utcDay } from "@/lib/ai-quota";

/** Download everything we hold about this creator as one JSON file. Secrets are never included. */
export const GET = route(
  async (_req, { user }) => {
    const body = JSON.stringify(await exportUser(user.id), null, 2);
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="outlly-export-${utcDay()}.json"`,
        "cache-control": "no-store",
      },
    });
  },
  { limit: [3, 3600_000] },
);
