import { json, route } from "@/lib/http";
import { inboxStateSchema, setCommentStates } from "@/lib/inbox-state";

export const dynamic = "force-dynamic";

/** Phase 2: mark comments read, unread, archived or back in the inbox, in one batch. Only stored in Outlly. */
export const PATCH = route(
  async (req, { user }) => {
    const body = inboxStateSchema.parse(await req.json());
    const states = await setCommentStates(user.id, body, user.scope);
    return json({ states });
  },
  { limit: [120, 60_000] },
);
