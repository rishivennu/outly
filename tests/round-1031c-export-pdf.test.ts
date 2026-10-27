// 1031c: "Download my data" is a readable PDF by default; JSON stays available with ?format=json.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let pdf: typeof import("../lib/export-pdf");
let account: typeof import("../lib/account");
let crypto: typeof import("../lib/crypto");
let uid = "";

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  pdf = await import("../lib/export-pdf");
  account = await import("../lib/account");
  crypto = await import("../lib/crypto");
  const u = await db.user.create({ data: { name: "Priyá Shah", email: `pdf-${Date.now()}@test.dev`, passwordHash: "x", timezone: "Asia/Kolkata" } });
  uid = u.id;
  const acc = await db.socialAccount.create({ data: { userId: uid, platform: "instagram", platformUserId: `1784${Date.now()}`, username: "@priya", accessToken: crypto.encrypt("SECRET-TOKEN-123"), status: "connected" } });
  for (let i = 0; i < 40; i++)
    await db.idea.create({ data: { userId: uid, text: `Idea ${i}: a hook about ₹999 phones, “quoted” — with a long link https://example.com/${"x".repeat(160)} 🎬`, source: "manual" } });
  const t = await db.dmThread.create({ data: { userId: uid, accountId: acc.id, platform: "instagram", platformThreadId: `t-${Date.now()}`, participantId: "p1", participantName: "Arjun", lastMessageAt: new Date() } });
  await db.dmMessage.create({ data: { threadId: t.id, platformMessageId: `m-${Date.now()}`, direction: "in", text: crypto.encrypt("Hi, love the reel!"), sentAt: new Date() } });
});
afterAll(async () => {
  await db.user.delete({ where: { id: uid } }).catch(() => {});
});

const text = (b: Buffer) => b.toString("latin1");

describe("data export PDF", () => {
  test("pdfSafe maps what Helvetica can't draw", () => {
    expect(pdf.pdfSafe("₹499 — “ok” … é 🎬")).toBe('INR 499 - "ok" ... e');
    expect(pdf.pdfSafe("Hi 👋🏽 नमस्ते team")).toBe("Hi ? team");
  });
  test("wrap never returns a line wider than the page, even for one long link", () => {
    const lines = pdf.wrap(`see https://example.com/${"a".repeat(400)} now`, 10, 300);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.length).toBeLessThan(80);
  });

  test("renders a valid multi-page PDF with every section and no secrets", async () => {
    const data = await account.exportUser(uid);
    const b = pdf.renderExportPdf(data);
    const s = text(b);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)?.[1]);
    expect(pages).toBeGreaterThan(1);
    expect(s).toContain(`(Page ${pages} of ${pages})`);
    for (const h of ["Your Outlly data", "Profile", "Connected accounts", "Posts", "Uploads", "Ideas", "Invoices", "Direct messages", "Hi, love the reel!"]) expect(s).toContain(h);
    expect(s).toContain("Priya Shah"); // accent folded, not dropped
    expect(s).not.toContain("SECRET-TOKEN-123");
    expect(s).not.toMatch(/[^\x00-\xff]/);
    // xref offsets point at real objects
    const xref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const first = /0000000000 65535 f \n(\d{10})/.exec(s)?.[1];
    expect(s.slice(Number(first), Number(first) + 7)).toBe("1 0 obj");
  });

  test("an empty studio still gets a short, tidy copy", () => {
    const b = pdf.renderExportPdf({ exportedAt: new Date().toISOString(), profile: { name: "", email: "a@b.c", createdAt: new Date() }, accounts: [], posts: [], media: [], ideas: [], snippets: [], subscriptions: [], invoices: [], directMessages: [] });
    expect(Number(/\/Count (\d+)/.exec(text(b))?.[1])).toBeLessThanOrEqual(2);
    expect(text(b)).toContain("No posts yet.");
  });
});
