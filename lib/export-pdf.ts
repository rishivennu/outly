/**
 * "Download my data" as a readable PDF (1031). Same dependency-free approach as the invoice writer
 * (lib/billing/pdf.ts) but many A4 pages: word wrap with real Helvetica widths, headings, a summary,
 * and "Page n of N" footers. The base-14 fonts only cover Latin-1, so other characters are mapped
 * (₹ -> INR, curly quotes, accents), emoji are dropped and other scripts show as "?". The
 * JSON copy keeps every character exactly, and the PDF says so.
 */
export type ExportData = {
  exportedAt: string;
  profile: { name: string; email: string; timezone?: string | null; postingGoal?: number | null; weeklyReport?: boolean | null; signupSource?: string | null; referralCode?: string | null; createdAt: Date | string; lastActiveAt?: Date | string | null };
  accounts: { platform: string; username: string; displayName?: string | null; status: string; createdAt: Date | string }[];
  posts: {
    title?: string | null; story?: string | null; hook?: string | null; status: string; scheduledAt?: Date | string | null; publishedAt?: Date | string | null; createdAt: Date | string;
    targets: { platform: string; title?: string | null; caption?: string | null; description?: string | null; hashtags?: string | null; platformStatus: string; platformUrl?: string | null; practice?: boolean | null; publishedAt?: Date | string | null }[];
  }[];
  media: { originalFilename: string; mimeType: string; size: number; duration?: number | null; width?: number | null; height?: number | null; status: string; createdAt: Date | string }[];
  ideas: { text: string; source?: string | null; doneAt?: Date | string | null; createdAt: Date | string }[];
  snippets: { kind: string; name: string; body: string; uses: number; createdAt: Date | string }[];
  subscriptions: { status: string; priceMinor: number; currency: string; interval: string; provider?: string | null; currentPeriodEnd?: Date | string | null; cancelAtPeriodEnd?: boolean | null; canceledAt?: Date | string | null; createdAt: Date | string; plan?: { name: string } | null }[];
  invoices: { number: string; description?: string | null; amountMinor: number; currency: string; issuedAt: Date | string }[];
  directMessages: { platform: string; account: string; with: string | null; handle?: string | null; lastMessageAt?: Date | string | null; messages: { direction: string; text: string; attachments: unknown; sentAt: Date | string }[] }[];
};

type RGB = [number, number, number];
const INK: RGB = [0.07, 0.08, 0.1];
const SOFT: RGB = [0.33, 0.35, 0.4];
const RULE: RGB = [0.85, 0.86, 0.88];
const LIME: RGB = [0.776, 0.988, 0.231];
const W = 595, H = 842, M = 50, TOP = H - 56, BOTTOM = 60;

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard AFM.
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

/** Map text onto what Helvetica/WinAnsi can draw. */
export function pdfSafe(t: string): string {
  return String(t ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/₹/g, "INR ")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2018\u2019\u201a]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25cf]/g, "*")
    .replace(/[\u00a0\u2009\u200a\u202f]/g, " ")
    .replace(/[\u200b-\u200d\ufe0f]/g, "")
    .replace(/\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]/gu, "") // emoji are left out rather than shown as "?"
    .replace(/ +\n/g, "\n")
    .replace(/(\S) {2,}(?=\S)/g, "$1 ")
    .replace(/ +$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\n\x20-\x7e\u00a1-\u00ff]/gu, "?")
    .replace(/\?{2,}/g, "?");
}
const width = (t: string, size: number, bold = false) => {
  let w = 0;
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HW[c - 32] : 556;
  }
  return (w / 1000) * size * (bold ? 1.07 : 1);
};
const esc = (t: string) => t.replace(/([\\()])/g, "\\$1");

/** Greedy wrap; words wider than the line are hard-broken (long links). */
export function wrap(text: string, size: number, max: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      let w = word;
      while (width(w, size, bold) > max) {
        let i = w.length - 1;
        while (i > 1 && width(w.slice(0, i), size, bold) > max) i--;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      const next = line ? `${line} ${w}` : w;
      if (width(next, size, bold) <= max) line = next;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

class Doc {
  pages: string[][] = [[]];
  y = TOP;
  private get ops() { return this.pages[this.pages.length - 1]; }
  newPage() { this.pages.push([]); this.y = TOP; }
  ensure(h: number) { if (this.y - h < BOTTOM) this.newPage(); }
  text(x: number, y: number, t: string, size: number, bold = false, rgb: RGB = INK) {
    this.ops.push(`BT ${rgb.map((c) => c.toFixed(3)).join(" ")} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(t)}) Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, rgb: RGB) { this.ops.push(`${rgb.map((c) => c.toFixed(3)).join(" ")} rg ${[x, y, w, h].map((v) => +v.toFixed(2)).join(" ")} re f`); }
  rule(rgb: RGB = RULE) { this.ops.push(`${rgb.map((c) => c.toFixed(3)).join(" ")} RG 0.7 w ${M} ${this.y.toFixed(1)} m ${W - M} ${this.y.toFixed(1)} l S`); }
  /** Wrapped paragraph that flows across pages. */
  para(t: string, { size = 10, bold = false, rgb = INK, indent = 0, gap = 4 }: { size?: number; bold?: boolean; rgb?: RGB; indent?: number; gap?: number } = {}) {
    const lh = size * 1.38;
    for (const l of wrap(t, size, W - 2 * M - indent, bold)) {
      this.ensure(lh);
      this.y -= lh;
      this.text(M + indent, this.y, l, size, bold, rgb);
    }
    this.y -= gap;
  }
  /** Section title: keeps at least a few lines of body with it. */
  h1(t: string, note?: string) {
    this.ensure(96);
    this.y -= 28;
    this.rect(M, this.y - 4, 4, 20, LIME);
    this.text(M + 12, this.y, pdfSafe(t), 16, true);
    this.y -= 10;
    if (note) this.para(note, { size: 9.5, rgb: SOFT, gap: 6 });
    else this.y -= 4;
  }
  h2(t: string) { this.ensure(48); this.y -= 6; this.para(t, { size: 11.5, bold: true, gap: 2 }); }
  /** "Label   value" rows with the label in a fixed column. */
  kv(label: string, value: string, indent = 0) {
    const lw = 120, size = 10, lh = size * 1.38;
    const lines = wrap(value || "-", size, W - 2 * M - indent - lw);
    lines.forEach((l, i) => {
      this.ensure(lh);
      this.y -= lh;
      if (i === 0) this.text(M + indent, this.y, pdfSafe(label), size, false, SOFT);
      this.text(M + indent + lw, this.y, l, size);
    });
    this.y -= 2;
  }
  build(footer: string): Buffer {
    const n = this.pages.length;
    const objs: string[] = [];
    const add = (o: string) => objs.push(o) && objs.length;
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add(""); // pages, filled below
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); // 3
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"); // 4
    const kids: number[] = [];
    this.pages.forEach((ops, i) => {
      const f = pdfSafe(footer);
      const pg = `Page ${i + 1} of ${n}`;
      const foot = [
        `0.85 0.86 0.88 RG 0.7 w ${M} 42 m ${W - M} 42 l S`,
        `BT 0.33 0.35 0.4 rg /F1 8.5 Tf ${M} 30 Td (${esc(f)}) Tj ET`,
        `BT 0.33 0.35 0.4 rg /F1 8.5 Tf ${(W - M - width(pg, 8.5)).toFixed(1)} 30 Td (${esc(pg)}) Tj ET`,
      ];
      const content = [...ops, ...foot].join("\n");
      const c = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`));
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${n} >>`;
    const info = add(`<< /Title (Your Outlly data) /Producer (Outlly) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, "latin1");
  }
}

const PLATFORM: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", x: "X", threads: "Threads", linkedin: "LinkedIn" };
const plat = (p: string) => PLATFORM[p] ?? p;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "-");
const money = (minor: number, cur: string) => `${(cur || "").toUpperCase() === "INR" ? "INR" : (cur || "").toUpperCase()} ${(minor / 100).toFixed(2)}`;
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function renderExportPdf(data: ExportData): Buffer {
  let tz = data.profile.timezone || "UTC";
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "UTC"; }
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
  const when = (d?: Date | string | null) => (d ? fmt.format(new Date(d)) : "-");
  const on = (d?: Date | string | null) => (d ? day.format(new Date(d)) : "-");

  const d = new Doc();
  // Cover band
  d.rect(0, H - 150, W, 150, [0.06, 0.07, 0.09]);
  d.rect(M, H - 62, 34, 6, LIME);
  d.text(M, H - 96, "Your Outlly data", 26, true, [0.97, 0.97, 0.95]);
  d.text(M, H - 118, pdfSafe(`A readable copy of everything Outlly keeps about ${data.profile.name || "your studio"}.`), 11, false, [0.78, 0.79, 0.76]);
  d.text(M, H - 136, pdfSafe(`Made ${when(data.exportedAt)} (${tz})`), 9.5, false, [0.62, 0.63, 0.6]);
  d.y = H - 176;

  const dmCount = data.directMessages.reduce((a, t) => a + t.messages.length, 0);
  d.h1("What's inside");
  const rows: [string, string][] = [
    ["Profile", "Your account details"],
    ["Connected accounts", plural(data.accounts.length, "account")],
    ["Posts", plural(data.posts.length, "post")],
    ["Uploads", plural(data.media.length, "file")],
    ["Ideas", plural(data.ideas.length, "idea")],
    ["Saved snippets", plural(data.snippets.length, "snippet")],
    ["Subscriptions", plural(data.subscriptions.length, "subscription")],
    ["Invoices", plural(data.invoices.length, "invoice")],
    ["Direct messages", `${plural(data.directMessages.length, "conversation")}, ${plural(dmCount, "message")}`],
  ];
  for (const [k, v] of rows) d.kv(k, v);
  d.y -= 6;
  d.para("Never in here, because we never store them or they stay secret: your password, platform access tokens, and card or bank details. Times are shown in your time zone. This PDF font can't draw emoji (left out) or non-Latin scripts (shown as \"?\"). For an exact, machine-readable copy, pick the JSON option under Download PDF in Settings > Your data.", { size: 9.5, rgb: SOFT });

  d.h1("Profile");
  const p = data.profile;
  d.kv("Name", p.name);
  d.kv("Email", p.email);
  d.kv("Time zone", p.timezone || "-");
  d.kv("Posting goal", p.postingGoal ? `${p.postingGoal} posts a week` : "-");
  d.kv("Weekly report", p.weeklyReport ? "On" : "Off");
  d.kv("Found us through", p.signupSource || "-");
  d.kv("Referral code", p.referralCode || "-");
  d.kv("Joined", when(p.createdAt));
  d.kv("Last active", when(p.lastActiveAt));

  d.h1("Connected accounts", data.accounts.length ? undefined : "No accounts connected.");
  for (const a of data.accounts) d.kv(plat(a.platform), `${a.username}${a.displayName ? ` (${a.displayName})` : ""}, ${cap(a.status)}, since ${on(a.createdAt)}`);

  d.h1("Posts", data.posts.length ? "Each post with what went to every platform." : "No posts yet.");
  data.posts.forEach((post, i) => {
    d.h2(`${i + 1}. ${post.title || post.hook || "Untitled post"}`);
    d.kv("Status", cap(post.status));
    d.kv("Created", when(post.createdAt));
    if (post.scheduledAt) d.kv("Scheduled for", when(post.scheduledAt));
    if (post.publishedAt) d.kv("Published", when(post.publishedAt));
    if (post.hook && post.hook !== post.title) d.kv("Hook", post.hook);
    if (post.story) d.kv("Story", post.story);
    for (const t of post.targets) {
      d.ensure(40);
      d.y -= 4;
      d.para(`${plat(t.platform)}${t.practice ? " (practice)" : ""}: ${cap(t.platformStatus)}${t.publishedAt ? `, ${when(t.publishedAt)}` : ""}`, { size: 10, bold: true, indent: 14, gap: 1 });
      if (t.title) d.kv("Title", t.title, 14);
      if (t.caption) d.kv("Caption", t.caption, 14);
      if (t.description) d.kv("Description", t.description, 14);
      if (t.hashtags) d.kv("Hashtags", t.hashtags, 14);
      if (t.platformUrl) d.kv("Link", t.platformUrl, 14);
    }
    d.y -= 6;
    d.rule();
    d.y -= 4;
  });

  d.h1("Uploads", data.media.length ? "Details of the videos you uploaded (the files themselves stay in your library)." : "No uploads.");
  for (const m of data.media) {
    const bits = [m.mimeType, size(m.size), m.duration ? `${Math.round(m.duration)} s` : "", m.width && m.height ? `${m.width}x${m.height}` : "", cap(m.status), on(m.createdAt)].filter(Boolean);
    d.kv(m.originalFilename, bits.join(", "));
  }

  d.h1("Ideas", data.ideas.length ? undefined : "No ideas saved.");
  for (const idea of data.ideas) d.para(`* ${idea.text}${idea.doneAt ? " (done)" : ""}  -  ${on(idea.createdAt)}${idea.source ? `, from ${idea.source}` : ""}`, { indent: 4, gap: 3 });

  d.h1("Saved snippets", data.snippets.length ? undefined : "No snippets saved.");
  for (const s of data.snippets) {
    d.h2(`${s.name} (${cap(s.kind)}, used ${plural(s.uses, "time")})`);
    d.para(s.body, { indent: 4 });
  }

  d.h1("Subscriptions", data.subscriptions.length ? undefined : "You're on the Free plan. No paid subscriptions.");
  for (const s of data.subscriptions) {
    d.h2(`${s.plan?.name ?? "Plan"}: ${money(s.priceMinor, s.currency)} / ${s.interval}`);
    d.kv("Status", `${cap(s.status)}${s.cancelAtPeriodEnd ? ", ends at period end" : ""}`);
    d.kv("Paid through", s.provider ? cap(s.provider) : "-");
    d.kv("Started", on(s.createdAt));
    if (s.currentPeriodEnd) d.kv("Current period ends", on(s.currentPeriodEnd));
    if (s.canceledAt) d.kv("Cancelled", on(s.canceledAt));
  }

  d.h1("Invoices", data.invoices.length ? "Download the invoice PDFs themselves from Billing." : "No invoices.");
  for (const inv of data.invoices) d.kv(inv.number, `${money(inv.amountMinor, inv.currency)}, ${on(inv.issuedAt)}${inv.description ? `, ${inv.description}` : ""}`);

  d.h1("Direct messages", data.directMessages.length ? "Instagram and Facebook conversations Outlly keeps for your inbox (180 days)." : "No direct messages.");
  for (const t of data.directMessages) {
    const who = t.with ?? t.handle ?? "Someone";
    d.h2(`${plat(t.platform)}, ${t.account}, with ${who}${t.handle && t.handle !== who ? ` (${t.handle})` : ""}`);
    for (const m of t.messages) {
      const att = Array.isArray(m.attachments) && m.attachments.length ? ` [${plural(m.attachments.length, "attachment")}]` : "";
      d.para(`${when(m.sentAt)}  ${m.direction === "out" ? "You" : who}: ${m.text || ""}${att}`, { indent: 4, gap: 2, rgb: m.direction === "out" ? INK : [0.18, 0.2, 0.26] });
    }
    d.y -= 6;
  }

  return d.build(`Outlly data copy for ${data.profile.name || data.profile.email}`);
}
