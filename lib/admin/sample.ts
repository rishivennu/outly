import "server-only";
import { subDays, addMonths } from "date-fns";
import { db } from "../db";
import { ensurePlans } from "../billing/plans";

export const SAMPLE_DOMAIN = "sample.outly.test";
const FIRST = "Aarav Diya Kabir Meera Rohan Sana Vivaan Isha Arjun Tara Nikhil Zoya Dev Anya Kian Riya Neel Aditi Om Kavya Ira Yash Pari Reyansh Myra".split(" ");
const LAST = "Shah Rao Iyer Kapoor Nair Mehta Das Gill Menon Bose Reddy Joshi".split(" ");

/** Fills charts with 90 days of believable, clearly-flagged fake activity. Removed by clearSample(). */
export async function seedSample() {
  await ensurePlans();
  await clearSample();
  const plans = await db.plan.findMany({ where: { priceMinor: { gt: 0 } } });
  let rnd = 7;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const now = new Date();
  for (let i = 0; i < 64; i++) {
    const age = Math.floor(Math.pow(r(), 0.7) * 88) + 1; // more recent signups: growth curve
    const createdAt = subDays(now, age);
    const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(r() * LAST.length)]}`;
    const u = await db.user.create({ data: { name, email: `${name.toLowerCase().replace(/\s/g, ".")}.${i}@${SAMPLE_DOMAIN}`, createdAt, lastActiveAt: subDays(now, Math.floor(r() * 9)) } });
    const engaged = r();
    const days: string[] = [];
    for (let d = 0; d <= age; d++) if (r() < 0.12 + engaged * 0.55) days.push(subDays(now, d).toISOString().slice(0, 10));
    if (days.length) await db.userActivityDay.createMany({ data: days.map((day) => ({ userId: u.id, day })) });
    if (plans.length && r() < 0.42) {
      const plan = plans[r() < 0.75 ? 0 : plans.length - 1];
      const start = subDays(now, Math.floor(r() * Math.min(age, 75)));
      const canceled = r() < 0.18 ? subDays(now, Math.floor(r() * 20)) : null;
      const s = await db.subscription.create({
        data: { userId: u.id, planId: plan.id, status: canceled && canceled > start ? "canceled" : "active", priceMinor: plan.priceMinor, currency: plan.currency, interval: plan.interval, provider: "mock", currentPeriodEnd: addMonths(start, 1), canceledAt: canceled && canceled > start ? canceled : null, sample: true, createdAt: start },
      });
      for (let m = start; m < now; m = addMonths(m, 1)) {
        const failed = r() < 0.07;
        await db.payment.create({ data: { userId: u.id, subscriptionId: s.id, planId: plan.id, amountMinor: plan.priceMinor, currency: plan.currency, provider: "mock", providerRef: `sample_${u.id}_${m.getTime()}`, status: failed ? "failed" : "succeeded", failureReason: failed ? "Card declined (sample)" : null, sample: true, createdAt: m } });
      }
    }
    if (r() < 0.12) {
      await db.ticket.create({
        data: { ref: `T-S${i.toString(36).toUpperCase()}${Math.floor(r() * 1e4)}`, email: u.email, name, userId: u.id, subject: ["Charged twice this month", "Can't connect Instagram", "Upload stuck at 90%", "How do I change my plan?"][i % 4], priority: ["urgent", "high", "high", "normal"][i % 4], status: r() < 0.4 ? "resolved" : "open", sample: true, createdAt: subDays(now, Math.floor(r() * 10)), messages: { create: [{ author: "customer", body: "Sample conversation for the dashboard preview." }] } },
      });
    }
  }
}

export async function clearSample() {
  // Invoices outlive their payment and user rows (kept for tax law), so sample ones are removed by hand.
  await db.invoice.deleteMany({ where: { OR: [{ payment: { sample: true } }, { customerEmail: { endsWith: `@${SAMPLE_DOMAIN}` } }] } });
  await db.payment.deleteMany({ where: { sample: true } });
  await db.ticket.deleteMany({ where: { sample: true } });
  await db.subscription.deleteMany({ where: { sample: true } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${SAMPLE_DOMAIN}` } } });
}
