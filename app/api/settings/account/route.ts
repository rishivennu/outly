import { z } from "zod";
import { deleteAccount } from "@/lib/account";
import { destroySession } from "@/lib/auth";
import { json, route } from "@/lib/http";

const Body = z.object({ confirm: z.string().trim().min(1, "Type your email address to confirm.").max(200) });

/** Delete the studio for good. The creator types their own email to confirm. */
export const DELETE = route(
  async (req, { user }) => {
    const { confirm } = Body.parse(await req.json());
    const out = await deleteAccount(user, confirm);
    destroySession();
    // The status page reads its token from the #fragment, so it never reaches a server log or a Referer.
    return json({ ok: true, status: `/account-deleted#${out.status}` });
  },
  { limit: [3, 3600_000] },
);
