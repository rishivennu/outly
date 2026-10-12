import "server-only";
import { db } from "../db";
import { cached, invalidate } from "../cache";
import { FAQS } from "../marketing/content";

export const FAQ_CATEGORIES = ["Payments", "Account", "Publishing", "Technical"] as const;

const EXTRA: { category: string; q: string; a: string }[] = [
  { category: "Payments", q: "Which payment methods do you accept?", a: "Cards, UPI and net banking through our payment partner. The exact options appear on the checkout screen and depend on your country." },
  { category: "Payments", q: "Where can I download my invoices?", a: "Open Billing from the sidebar. Every successful payment has a PDF invoice you can download any time, and a copy is emailed to you the moment the payment goes through." },
  { category: "Payments", q: "My payment failed. Was I charged?", a: "No. A failed payment is never charged. If money left your account anyway, it is usually a temporary hold that your bank releases within 5 to 7 working days. Try again, or use a different method." },
  { category: "Payments", q: "How do I cancel my subscription?", a: "Open Billing and choose Cancel plan. You keep everything until the end of the period you paid for, then the account moves to Free. You can resume any time before that date." },
  { category: "Payments", q: "Can I get a refund?", a: "If you were charged by mistake or something did not work, ask our team from this chat and a person will review it. Refunds go back to the original payment method." },
  { category: "Account", q: "How do I reset my password?", a: "On the sign-in page choose Forgot password, or sign in with Google if that is how you joined. If you no longer have access to the email, contact us from this chat." },
  { category: "Account", q: "How do I change the email on my account?", a: "Email changes need a quick identity check, so ask from this chat and our team will handle it." },
  { category: "Account", q: "How do I delete my account?", a: "Go to Settings and choose Delete account. Your uploads and posts are removed and active plans are cancelled. This can't be undone." },
  { category: "Technical", q: "My upload is stuck. What can I do?", a: "Check the file is MP4 or MOV and under the size limit of your plan, then retry. Big uploads resume where they left off, so a dropped connection doesn't mean starting over." },
];

/** First run: copy the marketing FAQ plus billing/account answers into the editable table. */
/** One-time, idempotent: FAQ rows seeded before the Outly -> Outlly rename get the new name. */
async function renameBrandInFaq() {
  if (await db.setting.findUnique({ where: { key: "migrate:outlly-faq" }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key: "migrate:outlly-faq", value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  const rows = await db.faqItem.findMany({ select: { id: true, question: true, answer: true } });
  const fix = (t: string) => t.replace(/\bOutly\b/g, "Outlly");
  for (const r of rows) {
    if (fix(r.question) !== r.question || fix(r.answer) !== r.answer) await db.faqItem.update({ where: { id: r.id }, data: { question: fix(r.question), answer: fix(r.answer) } });
  }
}

export async function ensureFaq() {
  if ((await db.faqItem.count()) > 0) return renameBrandInFaq();
  // a unique-key lock row: if two processes race (parallel build workers), only one seeds
  const won = await db.setting.create({ data: { key: "seed:faq", value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  const rows = [
    ...FAQS.map((f, i) => ({ category: /upload|limit|big|export|live/i.test(f.q) ? "Technical" : "Publishing", question: f.q, answer: f.a, sortOrder: i })),
    ...EXTRA.map((f, i) => ({ category: f.category, question: f.q, answer: f.a, sortOrder: 100 + i })),
  ];
  for (const r of rows) await db.faqItem.create({ data: r });
}

export async function listFaq(opts: { all?: boolean } = {}) {
  // The chatbot reads the FAQ on every message; cache it so chat stays fast under load.
  return cached(opts.all ? "faq:all" : "faq:published", 30_000, async () => {
    await ensureFaq();
    return db.faqItem.findMany({ where: opts.all ? {} : { published: true }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }] });
  });
}

/** Call after any FAQ edit so this instance serves the change on the next request. */
export function invalidateFaq() {
  invalidate("faq:");
}
