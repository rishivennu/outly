import { json, route } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth";
import { chatContext } from "@/lib/support/context";

export const dynamic = "force-dynamic";

/** Account cards for Pip. Signed-out visitors (marketing pages) just get an empty list. */
export const GET = route(
  async () => {
    const user = await getCurrentUser();
    if (!user) return json({ items: [] });
    return json({ items: await chatContext(user.id) }, { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [30, 60_000] },
);
