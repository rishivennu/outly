/**
 * Exportable client reports (1037): the analytics a manager hands to a client, as CSV (spreadsheets) or a
 * PDF (presentations). Pure, so both formats are unit-tested; the data is gathered in client-report-server.ts.
 */
import { Doc, INK, LIME, M, SOFT, W, H, pdfSafe } from "../export-pdf";

export type ClientReport = {
  workspace: string;
  scope: string; // "All accounts" or "@name on Instagram"
  rangeDays: number;
  from: string; // ISO
  to: string;
  generatedAt: string;
  tz: string;
  totals: { views: number; likes: number; comments: number; shares: number; engagement: number };
  previousViews: number;
  byPlatform: { platform: string; views: number; engagement: number }[];
  byAccount: { platform: string; username: string; views: number; engagement: number; posts: number }[];
  daily: { date: string; views: number }[];
  posts: { title: string; platform: string; account: string; publishedAt: string | null; views: number; likes: number; comments: number; shares: number; url: string | null }[];
};

const NAMES: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", x: "X", threads: "Threads", linkedin: "LinkedIn" };
export const platformName = (p: string) => NAMES[p] ?? p;

/**
 * One CSV cell. Quotes when needed, and defuses spreadsheet formulas: a caption starting with = + - @ (or a
 * tab/CR) would otherwise run as a formula when the client opens the file.
 */
export function csvCell(v: string | number | null | undefined) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");
const pct = (n: number) => Math.round(n * 10) / 10;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Sections one after another with a blank line between, so it reads in Excel and Sheets without macros. */
export function reportCsv(r: ClientReport) {
  const out = [
    row(["Outlly report", r.workspace]),
    row(["Accounts", r.scope]),
    row(["Period", `${day(r.from)} to ${day(r.to)}`, `${r.rangeDays} days`]),
    row(["Generated", r.generatedAt]),
    "",
    row(["Totals", "Views", "Likes", "Comments", "Shares", "Engagement %", "Views, previous period"]),
    row(["", r.totals.views, r.totals.likes, r.totals.comments, r.totals.shares, pct(r.totals.engagement), r.previousViews]),
    "",
    row(["Platform", "Views", "Engagement %"]),
    ...r.byPlatform.map((p) => row([platformName(p.platform), p.views, pct(p.engagement)])),
    "",
    row(["Account", "Platform", "Posts", "Views", "Engagement %"]),
    ...r.byAccount.map((a) => row([a.username, platformName(a.platform), a.posts, a.views, pct(a.engagement)])),
    "",
    row(["Post", "Platform", "Account", "Published", "Views", "Likes", "Comments", "Shares", "Link"]),
    ...r.posts.map((p) => row([p.title, platformName(p.platform), p.account, day(p.publishedAt), p.views, p.likes, p.comments, p.shares, p.url])),
    "",
    row(["Date", "Views"]),
    ...r.daily.map((d) => row([d.date, d.views])),
  ];
  // BOM so Excel opens accents and non-Latin names correctly
  return "\ufeff" + out.join("\r\n") + "\r\n";
}

const fmtN = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US"));

/** A4 PDF in the same house style as the data export: cover band, totals, tables, a daily views chart. */
export function reportPdf(r: ClientReport): Buffer {
  const d = new Doc();
  d.rect(0, H - 150, W, 150, [0.06, 0.07, 0.09]);
  d.rect(M, H - 62, 34, 6, LIME);
  d.text(M, H - 96, pdfSafe(`${r.workspace}: performance report`).slice(0, 60), 24, true, [0.97, 0.97, 0.95]);
  d.text(M, H - 118, pdfSafe(`${r.scope}. ${day(r.from)} to ${day(r.to)} (${r.rangeDays} days)`).slice(0, 95), 11, false, [0.78, 0.79, 0.76]);
  d.text(M, H - 136, pdfSafe(`Made ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC with Outlly`), 9.5, false, [0.62, 0.63, 0.6]);
  d.y = H - 176;

  d.h1("Headline numbers", "Counted from posts published through Outlly.");
  const change = r.previousViews ? Math.round(((r.totals.views - r.previousViews) / r.previousViews) * 100) : null;
  const cards: [string, string][] = [
    ["Views", fmtN(r.totals.views)],
    ["Likes", fmtN(r.totals.likes)],
    ["Comments", fmtN(r.totals.comments)],
    ["Shares", fmtN(r.totals.shares)],
    ["Engaged", `${pct(r.totals.engagement)}%`],
  ];
  const cw = (W - 2 * M - 4 * 8) / 5;
  d.ensure(70);
  d.y -= 62;
  cards.forEach(([k, v], i) => {
    const x = M + i * (cw + 8);
    d.rect(x, d.y, cw, 56, [0.95, 0.96, 0.93]);
    d.text(x + 10, d.y + 36, pdfSafe(k), 9, false, SOFT);
    d.text(x + 10, d.y + 14, pdfSafe(v), 16, true, INK);
  });
  d.y -= 8;
  if (change !== null) d.para(`${Math.abs(change)}% ${change >= 0 ? "more" : "fewer"} views than the ${r.rangeDays} days before.`, { size: 10, rgb: SOFT });

  const table = (head: string[], cols: number[], rows: string[][]) => {
    const lh = 16;
    const x0 = M;
    const line = (cells: string[], bold: boolean, rgb = INK) => {
      d.ensure(lh + 2);
      d.y -= lh;
      let x = x0;
      cells.forEach((c, i) => {
        const w = cols[i];
        let t = pdfSafe(c);
        while (t.length > 3 && t.length * 5.2 > w - 6) t = t.slice(0, -2);
        if (t !== pdfSafe(c)) t = t.slice(0, -1) + "...";
        d.text(x, d.y, t, 9.5, bold, rgb);
        x += w;
      });
    };
    line(head, true, SOFT);
    for (const rr of rows) line(rr, false);
    d.y -= 6;
  };

  if (r.byAccount.length) {
    d.h1("By account");
    table(["Account", "Platform", "Posts", "Views", "Engaged"], [190, 100, 60, 75, 70], r.byAccount.map((a) => [a.username, platformName(a.platform), String(a.posts), fmtN(a.views), `${pct(a.engagement)}%`]));
  }
  d.h1("By platform");
  table(["Platform", "Views", "Engaged"], [190, 100, 100], r.byPlatform.filter((p) => p.views > 0).map((p) => [platformName(p.platform), fmtN(p.views), `${pct(p.engagement)}%`]));

  // Daily views as simple bars: no fonts or images needed, prints cleanly
  if (r.daily.some((x) => x.views > 0)) {
    d.h1("Views by day");
    const ch = 110, cwid = W - 2 * M;
    d.ensure(ch + 24);
    d.y -= ch;
    const max = Math.max(...r.daily.map((x) => x.views), 1);
    const bw = cwid / r.daily.length;
    r.daily.forEach((x, i) => {
      const h = (x.views / max) * (ch - 6);
      if (h > 0) d.rect(M + i * bw + bw * 0.15, d.y, Math.max(1, bw * 0.7), h, [0.42, 0.62, 0.12]);
    });
    d.y -= 14;
    d.text(M, d.y, pdfSafe(day(r.daily[0]?.date ?? null)), 8.5, false, SOFT);
    const last = day(r.daily[r.daily.length - 1]?.date ?? null);
    d.text(W - M - last.length * 4.7, d.y, last, 8.5, false, SOFT);
    d.y -= 8;
  }

  if (r.posts.length) {
    d.h1("Posts", `The ${Math.min(r.posts.length, 40)} with the most views in this period.`);
    table(["Post", "Account", "Published", "Views", "Engaged"], [190, 120, 75, 60, 50], r.posts.slice(0, 40).map((p) => [p.title, `${p.account} (${platformName(p.platform)})`, day(p.publishedAt), fmtN(p.views), p.views ? `${pct(((p.likes + p.comments + p.shares) / p.views) * 100)}%` : "-"]));
  }
  return d.build(`${r.workspace} - Outlly report`, `${r.workspace} performance report`);
}
