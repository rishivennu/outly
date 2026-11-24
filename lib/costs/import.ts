import "server-only";
import { z } from "zod";
import { db } from "../db";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import { PROVIDER_IDS } from "./core";
import { BillBody, createBill } from "./manual";

/**
 * R1315 CSV invoice import. Header row required; columns provider, invoiceId, periodStart, periodEnd, amount,
 * currency, status, note (any order, case-insensitive, extra columns ignored). `amount` is in major units (12.50),
 * stored as minor. Preview first: every line comes back as ok | duplicate | error with its reason, and nothing is
 * written until the admin commits, which books the ok lines through the same path as a hand-typed bill.
 */
export const IMPORT_COLUMNS = ["provider", "invoiceId", "periodStart", "periodEnd", "amount", "currency", "status", "note"] as const;
const REQUIRED = ["provider", "invoiceId", "periodStart", "periodEnd", "amount"] as const;
const MAX_ROWS = 500;

export interface ImportRow { line: number; status: "ok" | "duplicate" | "error"; reason: string; bill: z.input<typeof BillBody> | null; raw: Record<string, string> }
export interface ImportPreview { columns: string[]; rows: ImportRow[]; ok: number; duplicates: number; errors: number }

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, trailing blank lines dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const norm = (h: string) => h.trim().replace(/[\s_-]+/g, "").toLowerCase();
const COLUMN_BY_NORM: Record<string, (typeof IMPORT_COLUMNS)[number]> = Object.fromEntries(IMPORT_COLUMNS.map((c) => [norm(c), c])) as never;
const ALIAS: Record<string, (typeof IMPORT_COLUMNS)[number]> = { invoice: "invoiceId", invoiceno: "invoiceId", invoicenumber: "invoiceId", id: "invoiceId", start: "periodStart", from: "periodStart", end: "periodEnd", to: "periodEnd", total: "amount", notes: "note", memo: "note", state: "status" };

/** Lines to candidate bills; no database access, so it is unit-testable and the API can show it before committing. */
export function parseBills(csv: string): { columns: string[]; rows: ImportRow[] } {
  const table = parseCsv(csv);
  if (table.length === 0) throw new HttpError(400, "The file is empty.", "VALIDATION");
  const header = table[0].map((h) => COLUMN_BY_NORM[norm(h)] ?? ALIAS[norm(h)] ?? norm(h));
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new HttpError(400, `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Expected a header row with ${IMPORT_COLUMNS.join(", ")}.`, "VALIDATION");
  if (table.length - 1 > MAX_ROWS) throw new HttpError(400, `Up to ${MAX_ROWS} invoices per file; this one has ${table.length - 1}.`, "VALIDATION");
  const rows: ImportRow[] = table.slice(1).map((cells, i) => {
    const raw: Record<string, string> = {};
    header.forEach((h, j) => { raw[h] = (cells[j] ?? "").trim(); });
    const line = i + 2;
    const amountText = raw.amount.replace(/[,\s]/g, "").replace(/^(USD|INR|EUR|GBP|[$₹€£])/i, ""); // "$1,234.50" and "₹ 900" are numbers too
    const amount = amountText === "" ? NaN : Number(amountText);
    if (!Number.isFinite(amount) || amount < 0) return { line, status: "error", reason: `Amount "${raw.amount}" is not a number.`, bill: null, raw };
    const provider = raw.provider.toLowerCase();
    if (!PROVIDER_IDS.includes(provider as never)) return { line, status: "error", reason: `Unknown provider "${raw.provider}". Known: ${PROVIDER_IDS.join(", ")}.`, bill: null, raw };
    const candidate = { provider, invoiceId: raw.invoiceId, category: raw.category || undefined, periodStart: raw.periodStart, periodEnd: raw.periodEnd, amountMinor: Math.round(amount * 100), currency: (raw.currency || "USD").toUpperCase(), status: (raw.status || "paid").toLowerCase(), note: raw.note || "" };
    const parsed = BillBody.safeParse(candidate);
    if (!parsed.success) { const is = parsed.error.issues[0]; return { line, status: "error", reason: `${is.path.join(".") || "row"}: ${is.message}`, bill: null, raw }; }
    if (parsed.data.periodEnd <= parsed.data.periodStart) return { line, status: "error", reason: "The period's end must be after its start.", bill: null, raw };
    return { line, status: "ok", reason: "", bill: candidate as z.input<typeof BillBody>, raw };
  });
  // The same invoice twice in one file is a duplicate too; the first occurrence wins.
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.status !== "ok" || !r.bill) continue;
    const k = `${r.bill.provider}/${r.bill.invoiceId}`;
    if (seen.has(k)) { r.status = "duplicate"; r.reason = `Repeated in this file (line ${rows.find((x) => x.bill && `${x.bill.provider}/${x.bill.invoiceId}` === k)!.line}).`; }
    seen.add(k);
  }
  return { columns: header, rows };
}

const summarise = (columns: string[], rows: ImportRow[]): ImportPreview => ({ columns, rows, ok: rows.filter((r) => r.status === "ok").length, duplicates: rows.filter((r) => r.status === "duplicate").length, errors: rows.filter((r) => r.status === "error").length });

/** Preview: parsed lines plus a duplicate check against bills already on file (provider + invoiceId). */
export async function previewBills(csv: string): Promise<ImportPreview> {
  const { columns, rows } = parseBills(csv);
  const ok = rows.filter((r) => r.status === "ok" && r.bill);
  if (ok.length) {
    const existing = await db.billingRecord.findMany({ where: { OR: ok.map((r) => ({ provider: r.bill!.provider, invoiceId: r.bill!.invoiceId })) }, select: { provider: true, invoiceId: true } });
    const have = new Set(existing.map((b) => `${b.provider}/${b.invoiceId}`));
    for (const r of ok) if (have.has(`${r.bill!.provider}/${r.bill!.invoiceId}`)) { r.status = "duplicate"; r.reason = "Already recorded."; }
  }
  return summarise(columns, rows);
}

const Body = z.object({ csv: z.string().min(1).max(2_000_000), commit: z.boolean().default(false) });

/** The API entry: `{ csv, commit }`. Without commit, the preview; with it, the ok lines are booked one by one and the result says which landed. */
export async function importBills(input: unknown, by: { login: string }): Promise<ImportPreview & { committed: number }> {
  const b = Body.parse(input);
  const preview = await previewBills(b.csv);
  if (!b.commit) return { ...preview, committed: 0 };
  let committed = 0;
  for (const r of preview.rows) {
    if (r.status !== "ok" || !r.bill) continue;
    try { await createBill(r.bill, by); committed++; r.reason = "Recorded."; }
    catch (e) { r.status = e instanceof HttpError && e.status === 409 ? "duplicate" : "error"; r.reason = e instanceof Error ? e.message : "Could not record."; }
  }
  if (committed) await adminEvent("costs", `Bills imported: ${committed} from CSV`, by.login, "/admin/costs");
  return { ...summarise(preview.columns, preview.rows), committed };
}
