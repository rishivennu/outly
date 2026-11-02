import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { saveConnectedAccount } from "@/lib/accounts";
import { holdChoice, knownAccounts, takeChoice, viewChoice } from "@/lib/connect-choice";
import { entitlements } from "@/lib/billing/entitlements";
import { accountView } from "@/lib/services";
import { invalidateDashboards } from "@/lib/live";

export const dynamic = "force-dynamic";

const GONE = "That sign-in waited too long, so nothing was saved. Connect again.";

/** The question the Accounts page asks after a sign-in (1095). Names only; the held tokens never leave the server. */
export const GET = route(async (_req, { user, params }) => {
  if (user.actor) throw new HttpError(403, "Only the workspace owner can connect accounts.", "ROLE");
  const v = await viewChoice(params.id ?? "", user.id);
  if (!v) throw new HttpError(404, GONE, "EXPIRED");
  return json({ choice: v });
});

const body = z.object({ action: z.enum(["save", "discard"]) });

/**
 * The creator's answer. "save" is the explicit go-ahead for exactly what the dialog said: reconnect this
 * account, or let it replace the one named. "discard" (Connect a different account, Keep, or closing the
 * dialog) throws the held sign-in away. Either way the hold is used up.
 */
export const POST = route(
  async (req, { user, params }) => {
    if (user.actor) throw new HttpError(403, "Only the workspace owner can connect accounts.", "ROLE");
    const { action } = body.parse(await req.json());
    const c = await takeChoice(params.id ?? "", user.id);
    if (!c) throw new HttpError(404, GONE, "EXPIRED");
    if (action === "discard") return json({ ok: true });
    // The answer may come minutes later. If another account was connected on this platform meanwhile, the
    // creator never agreed to replace it: ask again (with the sign-in held anew) instead of failing or replacing.
    if ((await entitlements(user.id)).accountLimit === 0) {
      const agreed = new Set(c.decision.replaces.map((x) => x.id));
      const now = (await knownAccounts(user.id, c.platform)).filter((x) => x.status !== "disconnected" && x.platformUserId !== c.prof.platformUserId);
      if (now.some((x) => !agreed.has(x.id))) {
        const again = await holdChoice({ ...c, decision: { kind: "replace", replaces: now } });
        return json({ choice: await viewChoice(again, user.id) });
      }
    }
    const a = await saveConnectedAccount(user.id, c.platform, c.prof, { replace: c.decision.replaces.length > 0 });
    invalidateDashboards(user.id);
    return json({ account: accountView(a), replaced: c.decision.replaces.map((r) => r.id) });
  },
  { limit: [20, 60_000] },
);
