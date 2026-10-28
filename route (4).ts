import { z } from "zod";
import { json, route } from "@/lib/http";
import { claimFounding, clearFoundingCache, myFounding, sendClaimLink } from "@/lib/founding";
import { HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user }) => json({ founding: await myFounding(user.id) }));

const Body = z.object({ action: z.enum(["send", "claim"]) });

/**
 * send: email the claim link to the signed-in member's own address (never to an address they type).
 * claim: an already proven inbox takes its seat. Claiming only ever happens on a POST, never on a page load.
 */
export const POST = route(async (req, { user }) => {
  const { action } = Body.parse(await req.json());
  if (user.actor) throw new HttpError(403, "Founding seats belong to the workspace owner.", "ROLE");
  const mine = await myFounding(user.id);
  if (mine?.kind !== "claim") throw new HttpError(409, mine?.kind === "member" ? "You're already a founding member." : "There's no founding seat to claim right now.", "NO_SEAT");
  if (action === "claim") {
    const r = await claimFounding(user.id);
    clearFoundingCache();
    return json({ ok: r.result === "claimed" || r.result === "already", result: r.result, no: r.no ?? null });
  }
  if (mine.reason !== "unverified") throw new HttpError(409, "Your inbox is already confirmed. Claim your seat instead.", "PROVEN");
  await sendClaimLink(user.id);
  return json({ ok: true, to: mine.email });
}, { limit: [5, 60 * 60_000] });
