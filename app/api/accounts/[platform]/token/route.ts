import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { saveConnectedAccount } from "@/lib/accounts";
import { InstagramPublisher } from "@/lib/social/instagram";
import { PublisherError } from "@/lib/social/types";
import { accountView } from "@/lib/services";
import { invalidateDashboards } from "@/lib/live";

export const dynamic = "force-dynamic";

const body = z.object({ token: z.string().trim().min(40).max(600) });

/** Connect Instagram with a long-lived token from the Meta app dashboard (no app secret needed). */
export const POST = route(
  async (req, { user, params }) => {
    if (params?.platform !== "instagram") throw new HttpError(404, "Token connect is only available for Instagram.");
    const { token } = body.parse(await req.json());
    let prof;
    try {
      prof = await new InstagramPublisher().connectWithToken(token);
    } catch (e) {
      // Instagram answers a bad token with a generic 400; say what it means here, keep the raw reason in logs.
      console.warn("[instagram token connect]", e instanceof PublisherError ? (e.technical ?? e.message) : e);
      throw new HttpError(400, "Instagram didn't accept that token. Generate a fresh one in the Meta dashboard and paste it again.", "NOT_CONNECTED");
    }
    const a = await saveConnectedAccount(user.id, "instagram", prof);
    invalidateDashboards(user.id);
    return json({ account: accountView(a) }, { status: 201 });
  },
  { limit: [10, 60_000] },
);
