import { json, route } from "@/lib/http";
import { isPlatform } from "@/lib/domain";
import { inbox } from "@/lib/inbox";

export const dynamic = "force-dynamic";

export const GET = route(
  async (req, { user }) => {
    const raw = req.nextUrl.searchParams.get("platform");
    const platform = raw && isPlatform(raw) ? raw : undefined;
    return json(await inbox(user.id, platform, user.scope));
  },
  { limit: [60, 60_000] },
);
