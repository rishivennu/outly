import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { sendEmail, templates } from "@/lib/email";

const Body = z.object({ userId: z.string().min(1).max(64), note: z.string().trim().max(600).optional() });
const MONTH = 30 * 864e5;

/** Sends one win-back email. At most one a month per creator, however many people click. */
export const POST = adminRoute(
  "retention",
  async (req, { admin }) => {
    const { userId, note } = Body.parse(await req.json());
    const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
    if (!u) throw new HttpError(404, "That creator no longer exists.", "NOT_FOUND");
    const now = new Date();
    // Claim first, so two admins clicking at once send one email.
    const claimed = await db.user.updateMany({
      where: { id: u.id, OR: [{ winbackAt: null }, { winbackAt: { lte: new Date(now.getTime() - MONTH) } }] },
      data: { winbackAt: now },
    });
    if (!claimed.count) throw new HttpError(409, `${u.name} already got a win-back email in the last 30 days.`, "TOO_SOON");
    const last = await db.postTarget.findFirst({
      where: { post: { userId: u.id }, practice: false, platformStatus: "published" },
      orderBy: { publishedAt: "desc" },
      select: { publishedAt: true },
    });
    const lastPost = last?.publishedAt ? last.publishedAt.toLocaleDateString("en-IN", { day: "numeric", month: "long" }) : null;
    const r = await sendEmail({
      to: u.email,
      kind: "winback",
      subject: "Your studio misses you",
      html: templates.winback({ name: u.name.split(" ")[0], lastPost: lastPost ? `on ${lastPost}` : null, url: `${env.APP_URL}/home`, note: note || null }),
    });
    if (!r.ok && r.status === "failed") {
      await db.user.update({ where: { id: u.id }, data: { winbackAt: null } }).catch(() => {});
      throw new HttpError(502, r.error ?? "The email provider refused it. Nothing was sent.", "EMAIL_FAILED");
    }
    await adminEvent("retention", `Win-back email to ${u.name}`, `Sent by ${admin.name}${note ? " with a personal note" : ""}.`, "/admin/retention");
    return json({ ok: true, status: r.status });
  },
  [20, 60_000],
);
