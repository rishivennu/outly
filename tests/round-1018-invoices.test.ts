/**
 * 10-18: invoices outlive account deletion (tax law), carry a snapshot of what they print, and are
 * deleted by the retention cron INVOICE_KEEP_YEARS after issue. Runs against the throwaway test DB.
 */
import { beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let account: typeof import("../lib/account");
let invoice: typeof import("../lib/billing/invoice");
let prune: typeof import("../lib/retention/prune");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  account = await import("../lib/account");
  invoice = await import("../lib/billing/invoice");
  prune = await import("../lib/retention/prune");
}, 60_000);

const mk = (tag: string) => db.user.create({ data: { name: `Inv ${tag}`, email: `inv-${tag}-${++n}-${Date.now()}@test.dev`, passwordHash: "hashed-secret" } });
const pay = (userId: string, ref: string) =>
  db.payment.create({ data: { userId, amountMinor: 49900, currency: "INR", provider: "youpi", providerRef: `${ref}-${Date.now()}-${n}`, status: "succeeded" } });

describe("invoice snapshot", () => {
  test("a new invoice copies the gateway, tax rate and seller details", async () => {
    const u = await mk("snap");
    const p = await pay(u.id, "snap");
    const inv = await invoice.issueInvoice(p.id, { email: false });
    expect(inv.provider).toBe("youpi");
    expect(inv.providerRef).toBe(p.providerRef);
    expect(typeof inv.taxPercent).toBe("number");
    expect(JSON.parse(inv.issuer!)).toHaveProperty("name");
  });
});

describe("account deletion keeps invoices for tax law", () => {
  test("the invoice survives, detached from the user and the payment, and still renders", async () => {
    const u = await mk("keep");
    const p = await pay(u.id, "keep");
    const inv = await invoice.issueInvoice(p.id, { email: false });
    // An invoice from before the snapshot columns: the delete must copy the gateway details first.
    const p2 = await pay(u.id, "legacy");
    const old = await db.invoice.create({ data: { number: `OUT-TEST-${Date.now()}-${n}`, paymentId: p2.id, userId: u.id, customerName: u.name, customerEmail: u.email, description: "Pro plan, 1 month", amountMinor: 49900, currency: "INR" } });

    expect(await account.deleteAccount({ id: u.id, actor: null }, u.email)).toEqual({ ok: true });
    expect(await db.user.count({ where: { id: u.id } })).toBe(0);
    expect(await db.payment.count({ where: { id: { in: [p.id, p2.id] } } })).toBe(0);

    const kept = await db.invoice.findMany({ where: { id: { in: [inv.id, old.id] } } });
    expect(kept.length).toBe(2);
    for (const k of kept) {
      expect(k.userId).toBeNull();
      expect(k.paymentId).toBeNull();
      expect(k.detachedAt).toBeInstanceOf(Date);
      expect(k.provider).toBe("youpi");
    }
    expect(kept.find((k) => k.id === old.id)!.providerRef).toBe(p2.providerRef);
    // ...and freezes the tax rate and seller, so later settings changes don't rewrite it.
    const frozen = kept.find((k) => k.id === old.id)!;
    expect(typeof frozen.taxPercent).toBe("number");
    expect(JSON.parse(frozen.issuer!)).toHaveProperty("gstin");
    const pdf = await invoice.invoicePdf(old.id);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
  test("a kept invoice is not reachable by a new account with the same email", async () => {
    const u = await mk("reuse");
    const p = await pay(u.id, "reuse");
    const inv = await invoice.issueInvoice(p.id, { email: false });
    await account.deleteAccount({ id: u.id, actor: null }, u.email);
    const again = await db.user.create({ data: { name: "Back", email: u.email, passwordHash: "x" } });
    expect(await db.invoice.count({ where: { userId: again.id } })).toBe(0);
    expect((await db.invoice.findUnique({ where: { id: inv.id } }))!.userId).toBeNull();
  });
});

describe("retention of detached invoices", () => {
  test(`deleted after ${8} years, kept before; a live account's old invoice is never touched`, async () => {
    expect(prune.INVOICE_KEEP_YEARS).toBe(8);
    const yearsAgo = (y: number, extraDays = 0) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - y);
      return new Date(d.getTime() - extraDays * 864e5);
    };
    const base = { customerName: "Gone", customerEmail: "gone@test.dev", description: "Pro plan, 1 month", amountMinor: 49900, currency: "INR" };
    const expired = await db.invoice.create({ data: { ...base, number: `OUT-EXP-${Date.now()}`, issuedAt: yearsAgo(8, 2), detachedAt: new Date() } });
    const young = await db.invoice.create({ data: { ...base, number: `OUT-YNG-${Date.now()}`, issuedAt: yearsAgo(7, 300), detachedAt: new Date() } });
    const u = await mk("live");
    const p = await pay(u.id, "live");
    const live = await db.invoice.create({ data: { ...base, number: `OUT-LIV-${Date.now()}`, userId: u.id, paymentId: p.id, issuedAt: yearsAgo(9) } });

    const out = await prune.pruneOldData();
    expect(out.detachedInvoices).toBeGreaterThanOrEqual(1);
    expect(await db.invoice.count({ where: { id: expired.id } })).toBe(0);
    expect(await db.invoice.count({ where: { id: young.id } })).toBe(1);
    expect(await db.invoice.count({ where: { id: live.id } })).toBe(1);
  });
});
