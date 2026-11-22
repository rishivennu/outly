import { json, route } from "@/lib/http";
import { myTickets } from "@/lib/support/tickets";

export const dynamic = "force-dynamic";

/** The "My requests" list app/(studio)/support/page.tsx renders server-side, for the native app. */
export const GET = route(async (_req, { user }) => json({ tickets: await myTickets(user) }, { headers: { "cache-control": "no-store" } }));
