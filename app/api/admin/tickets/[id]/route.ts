import { z } from "zod";
import { db } from "@/lib/db";
import { invalidate } from "@/lib/cache";
import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { sendEmail, templates } from "@/lib/email";

const Patch = z.object({ status: z.enum(["open", "pending", "resolved"]).optional(), priority: z.enum(["normal", "high", "urgent"]).optional() });
const Reply = z.object({ body: z.string().trim().min(1, "Write a reply first").max(5000), status: z.enum(["open", "pending", "resolved"]).optional() });

export const PATCH = adminRoute<{ params: { id: string } }>("tickets", async (req, { params }) => {
  const d = Patch.parse(await req.json());
  const t = await db.ticket.update({ where: { id: params.id }, data: d }).catch(() => null);
  if (!t) throw new HttpError(404, "Ticket not found", "NOT_FOUND");
  invalidate("admin:open-tickets");
  return json({ ticket: t });
});

/** Admin reply: stored on the thread and emailed to the customer. */
export const POST = adminRoute<{ params: { id: string } }>("tickets", async (req, { params, admin }) => {
  const d = Reply.parse(await req.json());
  const t = await db.ticket.findUnique({ where: { id: params.id } });
  if (!t) throw new HttpError(404, "Ticket not found", "NOT_FOUND");
  const status = d.status ?? "pending";
  const msg = await db.ticketMessage.create({ data: { ticketId: t.id, author: "admin", authorName: admin.name, body: d.body } });
  await db.ticket.update({ where: { id: t.id }, data: { status } });
  invalidate("admin:open-tickets");
  const mail = t.sample
    ? { ok: true, status: "skipped" }
    : await sendEmail({ to: t.email, subject: `Re: ${t.subject} [${t.ref}]`, kind: "ticket_reply", html: templates.ticketReply({ name: t.name ?? "", ref: t.ref, body: d.body, status: status === "resolved" ? "Resolved" : "Waiting on you" }) });
  return json({ message: msg, status, emailed: mail.ok, mailStatus: mail.status });
});
