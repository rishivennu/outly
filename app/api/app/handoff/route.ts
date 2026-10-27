import { z } from "zod";
import { readSessionUserId } from "@/lib/auth";
import { env } from "@/lib/env";
import { HttpError, json, route } from "@/lib/http";
import { browserTarget, signStart, validChallenge } from "@/lib/app-handoff";

export const dynamic = "force-dynamic";

const body = z.object({ to: z.string().max(2000), challenge: z.string() });

/** Step 1 (in the app): sign a link that starts a Google sign-in or an account connect in the browser. */
export const POST = route(
  async (req) => {
    const { to, challenge } = body.parse(await req.json());
    const target = browserTarget(to);
    if (!target) throw new HttpError(400, "That can't be opened in the browser.", "BAD_TARGET");
    if (!validChallenge(challenge)) throw new HttpError(400, "Start again from the app.", "BAD_CHALLENGE");
    // The person really signed in (not the workspace owner), so a connect runs as them in the browser too.
    const uid = await readSessionUserId();
    const t = await signStart({ uid, to: target, ch: challenge });
    return json({ url: `${env.APP_URL}/api/app/start?t=${encodeURIComponent(t)}` });
  },
  { auth: false, limit: [20, 60_000] },
);
