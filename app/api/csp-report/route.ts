import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http";

/**
 * Where browsers report what the Content Security Policy blocked (1033). Logged as one short line so a
 * broken embed or checkout shows up in the Vercel logs. Accepts the old report-uri shape and the Reporting
 * API batch; never stores anything, never echoes it back.
 */
export const dynamic = "force-dynamic";

type Report = { "blocked-uri"?: string; blockedURL?: string; "violated-directive"?: string; effectiveDirective?: string; "document-uri"?: string; documentURL?: string; "source-file"?: string; sourceFile?: string; "line-number"?: number; lineNumber?: number };

/** One printable line, capped: a report is attacker-controlled, so it must never forge or flood log lines. */
const clean = (v: unknown, max = 80) => (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").slice(0, max);

const short = (u?: unknown) => {
  if (typeof u !== "string" || !u) return "";
  try {
    const x = new URL(u);
    return clean(x.origin + x.pathname, 120); // never the query: it can carry tokens
  } catch {
    return clean(u);
  }
};

const TYPES = ["application/csp-report", "application/reports+json", "application/json"];

export async function POST(req: NextRequest) {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return new NextResponse(null, { status: 204 });
  // A page with a real problem reports the same thing over and over; 30 a minute per visitor is plenty.
  if (!rateLimit(`csp-report:${clientIp(req)}`, 30, 60_000).ok) return new NextResponse(null, { status: 204 });
  const text = await req.text().catch(() => "");
  if (!text || text.length > 16_000) return new NextResponse(null, { status: 204 });
  try {
    const j = JSON.parse(text);
    const list: Report[] = Array.isArray(j) ? j.map((r) => r?.body ?? {}) : [j?.["csp-report"] ?? {}];
    for (const r of list.slice(0, 5)) {
      const blocked = r["blocked-uri"] ?? r.blockedURL;
      const directive = clean(r["violated-directive"] ?? r.effectiveDirective, 40);
      if (!directive) continue;
      const line = Number(r["line-number"] ?? r.lineNumber);
      console.warn(`[csp] blocked ${short(blocked) || "inline"} by ${directive} on ${short(r["document-uri"] ?? r.documentURL)} ${short(r["source-file"] ?? r.sourceFile)}:${Number.isFinite(line) ? Math.trunc(line) : ""}`);
    }
  } catch {
    /* junk is ignored */
  }
  return new NextResponse(null, { status: 204 });
}
