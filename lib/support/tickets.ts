import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { sendEmail, templates } from "../email";
import { adminEvent } from "../admin/route";

const ALPH = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I: read aloud over the phone
const newRef = () => "T-" + [...randomBytes(6)].map((b) => ALPH[b % ALPH.length]).join("");

export interface TranscriptLine {
  role: "user" | "bot";
  text: string;
}

/**
 * Bot escalation: the bot failed twice (or the customer asked for a person). Raised as HIGH
 * priority so it jumps the admin queue; "urgent" if it mentions money leaving their account.
 */
export async function raiseTicket(o: { email: string; name?: string | null; userId?: string | null; transcript: TranscriptLine[]; reason: "bot_failed" | "asked_human" | "form" }) {
  const firstQ = o.transcript.find((t) => t.role === "user")?.text ?? "Support request";
  const subject = firstQ.length > 90 ? firstQ.slice(0, 87) + "..." : firstQ;
  const all = o.transcript.map((t) => t.text).join(" ");
  const priority = /\b(charged|debited|deducted|refund|double|twice|money)\b/i.test(all) ? "urgent" : o.reason === "form" ? "normal" : "high";
  // Same customer, same question, ticket still open in the last hour: append instead of duplicating.
  const dup = await db.ticket.findFirst({
    where: { email: o.email, subject, status: { not: "resolved" }, createdAt: { gt: new Date(Date.now() - 3600_000) } },
  });
  if (dup) return { ticket: dup, duplicate: true, emailed: true };

  let ticket = null;
  for (let i = 0; i < 5 && !ticket; i++) {
    try {
      ticket = await db.ticket.create({
        data: {
          ref: newRef(),
          email: o.email,
          name: o.name ?? null,
          userId: o.userId ?? null,
          subject,
          priority,
          source: o.reason === "form" ? "form" : "chatbot",
          messages: { create: o.transcript.slice(-20).map((t) => ({ author: t.role === "user" ? "customer" : "bot", body: t.text.slice(0, 2000) })) },
        },
      });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
    }
  }
  if (!ticket) throw new Error("Could not create a ticket");
  const mail = await sendEmail({
    to: o.email,
    subject: `We're on it: ticket ${ticket.ref}`,
    kind: "ticket_opened",
    html: templates.ticketOpened({ name: o.name ?? "", ref: ticket.ref, subject, url: `${env.APP_URL}/help` }),
  });
  await adminEvent(priority === "urgent" ? "ticket_urgent" : "ticket_new", `${priority === "urgent" ? "Urgent" : "New"} ticket ${ticket.ref}`, subject, `/admin/tickets/${ticket.id}`);
  return { ticket, duplicate: false, emailed: mail.ok };
}
