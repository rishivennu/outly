import "server-only";
import { db } from "../db";
import { cached, invalidate } from "../cache";
import { FAQS } from "../marketing/content";

export const FAQ_CATEGORIES = ["Payments", "Account", "Publishing", "Technical"] as const;

/** P4: the Music and copyright note on Create links here. Ships by default; also the fallback when the row is missing. */
export const MUSIC_FAQ = {
  category: "Publishing",
  q: "Will music in my video get it muted or flagged?",
  a: "It can. Instagram and YouTube check the sound in every video against songs that labels and artists own. On Instagram a match can mute the sound, limit who sees the post, or take it down. On YouTube it can bring a copyright claim, which lets the owner block the video or earn from it. Outlly posts the sound already in your file. It can't add music or clear a song for you. Original audio is safest: your own voice, sounds you recorded, or music you made or have a licence for. If a platform mutes a post, it usually stays up without sound. On YouTube you can often remove the claimed song in YouTube Studio. Anywhere else, delete the post and send a version with audio you own. Outlly never mutes or removes anything itself.",
};

const EXTRA: { category: string; q: string; a: string }[] = [
  { category: "Payments", q: "Which payment methods do you accept?", a: "Cards, UPI and net banking through our payment partner. The exact options appear on the checkout screen and depend on your country." },
  { category: "Payments", q: "Where can I download my invoices?", a: "Open Billing from the sidebar. Every successful payment has a PDF invoice you can download any time, and a copy is emailed to you the moment the payment goes through." },
  { category: "Payments", q: "My payment failed. Was I charged?", a: "No. A failed payment is never charged. If money left your account anyway, it is usually a temporary hold that your bank releases within 5 to 7 working days. Try again, or use a different method." },
  { category: "Payments", q: "How do I cancel my subscription?", a: "Open Billing and choose Cancel plan. You keep everything until the end of the period you paid for, then the account moves to Free. You can resume any time before that date." },
  { category: "Payments", q: "Can I get a refund?", a: "Yes. Your first payment has a 30-day money-back guarantee: open Billing and press Refund my payment, no reason needed. Your plan ends then and you move to Free, keeping your posts and media. Card, PayPal and Razorpay refunds go back at once (banks take 5 to 10 working days to show them); UPI ones are sent back by hand, usually within 2 working days. After 30 days, or for a later payment, ask our team here and a person will review it." },
  { category: "Account", q: "How do I reset my password?", a: "On the sign-in page choose Forgot password, or sign in with Google if that is how you joined. If you no longer have access to the email, contact us from this chat." },
  { category: "Account", q: "How do I change the email on my account?", a: "Email changes need a quick identity check, so ask from this chat and our team will handle it." },
  { category: "Account", q: "How do I delete my account?", a: "Open Settings and find Your data. Choose Delete account and type your account email to confirm. Your uploads, posts and connected accounts are removed and any active plan is cancelled. This can't be undone. To only stop Outlly posting somewhere, disconnect that platform in Accounts instead. You can also download a copy of your data from the same place first." },
  { category: "Technical", q: "My upload is stuck. What can I do?", a: "Check the file is MP4 or MOV and under the size limit of your plan, then retry. Big uploads resume where they left off, so a dropped connection doesn't mean starting over." },
  MUSIC_FAQ,
];

/** Short names a link can use to open one entry (/help?faq=music). Matched on the question, so an admin can edit the answer freely. */
export const FAQ_ANCHORS: Record<string, string> = { music: MUSIC_FAQ.q };

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

/** 10-15: there is no self-serve "Delete account" button; seeded rows that still promise one get the real steps. Admin-edited rows are left alone. */
const OLD_DELETE = "Go to Settings and choose Delete account. Your uploads and posts are removed and active plans are cancelled. This can't be undone.";
async function fixDeleteAnswer() {
  if (await db.setting.findUnique({ where: { key: "migrate:faq-delete-1015" }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key: "migrate:faq-delete-1015", value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  const answer = EXTRA.find((f) => f.q === "How do I delete my account?")?.a;
  if (answer) await db.faqItem.updateMany({ where: { answer: OLD_DELETE }, data: { answer } });
}

/** 10-16: Settings now has a self-serve Delete account (YourDataCard). The 10-15 "ask us" answer is updated; admin-edited rows are left alone. */
const OLD_DELETE_1015 = "Ask from this chat, or the contact page, using your account email. We confirm it is you, cancel any active plan, and delete your account, uploads, posts and connected accounts within 30 days. This can't be undone. To only stop Outlly posting somewhere, disconnect that platform in Accounts instead.";
async function fixDeleteAnswer1016() {
  if (await db.setting.findUnique({ where: { key: "migrate:faq-delete-1016" }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key: "migrate:faq-delete-1016", value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  const answer = EXTRA.find((f) => f.q === "How do I delete my account?")?.a;
  if (answer) await db.faqItem.updateMany({ where: { answer: { in: [OLD_DELETE, OLD_DELETE_1015] } }, data: { answer } });
}

/** 1076: the refund answer said a person reviews every refund; the 30-day guarantee is self-serve now. Admin edits are left alone. */
const OLD_REFUND = "If you were charged by mistake or something did not work, ask our team from this chat and a person will review it. Refunds go back to the original payment method.";
async function fixRefundAnswer() {
  const answer = EXTRA.find((f) => f.q === "Can I get a refund?")?.a;
  if (answer) await db.faqItem.updateMany({ where: { answer: OLD_REFUND }, data: { answer } });
}

/** P4: tables seeded before the music entry existed get it once. If an admin deletes it later, it stays deleted. */
async function addMusicFaq() {
  if (await db.setting.findUnique({ where: { key: "migrate:faq-music-p4" }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key: "migrate:faq-music-p4", value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  if (await db.faqItem.findFirst({ where: { question: MUSIC_FAQ.q }, select: { id: true } })) return;
  await db.faqItem.create({ data: { category: MUSIC_FAQ.category, question: MUSIC_FAQ.q, answer: MUSIC_FAQ.a, sortOrder: 200 } });
}

export async function ensureFaq() {
  if ((await db.faqItem.count()) > 0) {
    await renameBrandInFaq();
    await fixDeleteAnswer();
    await fixRefundAnswer();
    await addMusicFaq();
    return fixDeleteAnswer1016();
  }
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
