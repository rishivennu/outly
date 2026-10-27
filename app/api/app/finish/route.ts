import { z } from "zod";
import { createSession } from "@/lib/auth";
import { HttpError, json, route } from "@/lib/http";
import { redeemCode } from "@/lib/app-handoff";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().max(4000), verifier: z.string().max(200) });

/** Step 5 (in the app): trade the code and the app's verifier for a session in the app itself. */
export const POST = route(
  async (req) => {
    const { code, verifier } = body.parse(await req.json());
    const done = await redeemCode(code, verifier);
    if (!done) throw new HttpError(400, "That sign-in link has expired. Try again.", "EXPIRED");
    if (done.uid) await createSession(done.uid);
    return json({ next: done.next, signedIn: !!done.uid });
  },
  { auth: false, limit: [20, 60_000] },
);
