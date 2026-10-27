import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { json } from "@/lib/http";
import { randomToken } from "@/lib/crypto";
import { creds, loadKeys } from "@/lib/social/keys";
import { parseSignedRequest } from "@/lib/messages/webhook";

export const dynamic = "force-dynamic";

/**
 * Meta "Data deletion request" callback (1031), also usable as the "Deauthorize" callback.
 * Meta POSTs a form with signed_request = base64url(sig).base64url({ user_id, algorithm, issued_at }).
 * We disconnect every Instagram or Facebook account with that id, which deletes its tokens, and through
 * the database cascade its stored direct messages, then answer with the status page Meta asks for.
 */
export async function POST(req: NextRequest) {
  await loadKeys();
  const form = await req.formData().catch(() => null);
  const signed = (form?.get("signed_request") as string | null) ?? null;
  const data = parseSignedRequest(signed, [creds("facebook").clientSecret, creds("instagram").clientSecret]);
  if (!data?.user_id) return json({ error: "bad signed_request" }, { status: 400 });
  const id = String(data.user_id);
  if (!/^\d{1,40}$/.test(id)) return json({ error: "bad user id" }, { status: 400 });
  // Instagram names the account's Instagram id. Facebook names the person's app-scoped id, not the Page,
  // so Pages are matched through the id saved at connect time (metadata.metaUserId).
  const removed = await db.socialAccount.deleteMany({
    where: {
      OR: [
        { platform: { in: ["instagram", "facebook"] }, platformUserId: id },
        { platform: "facebook", metadata: { contains: `"metaUserId":"${id}"` } },
      ],
    },
  });
  const code = `del-${randomToken(9)}`;
  console.info("[meta deletion]", { code, removed: removed.count });
  return json({ url: `${env.APP_URL.replace(/\/$/, "")}/privacy#data-deletion`, confirmation_code: code });
}
