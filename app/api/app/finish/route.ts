import { z } from "zod";
import { createSession } from "@/lib/auth";
import { HttpError, json, route } from "@/lib/http";
import { redeemCode, takeHeld } from "@/lib/app-handoff";
import { saveConnectedAccount } from "@/lib/accounts";
import { invalidateDashboards } from "@/lib/live";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().max(4000), verifier: z.string().max(200) });

/** Step 5 (in the app): trade the code and the app's verifier for a session in the app itself. */
export const POST = route(
  async (req) => {
    const { code, verifier } = body.parse(await req.json());
    const done = await redeemCode(code, verifier);
    if (!done) throw new HttpError(400, "That sign-in link has expired. Try again.", "EXPIRED");
    let next = done.next;
    if (done.hold) {
      // The account the browser connected (1086): saved only now, by the app holding the verifier.
      const held = await takeHeld(done.hold, done.uid, done.ch);
      if (held) {
        await saveConnectedAccount(held.uid, held.platform, held.prof);
        invalidateDashboards(held.uid);
      } else next = connectExpired(next);
    }
    if (done.uid) await createSession(done.uid);
    return json({ next, signedIn: !!done.uid });
  },
  { auth: false, limit: [20, 60_000] },
);

/** "connected=instagram" becomes "connect_error=instagram&reason=state": the Accounts page says start again. */
function connectExpired(next: string) {
  const u = new URL(next, "http://outlly.invalid");
  const p = u.searchParams.get("connected");
  u.searchParams.delete("connected");
  u.searchParams.delete("notice");
  if (p) {
    u.searchParams.set("connect_error", p);
    u.searchParams.set("reason", "state");
  }
  return u.pathname + u.search;
}
