import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/http";
import { limitShared } from "@/lib/rate-limit";
import { sha256 } from "@/lib/crypto";
import { optIn, optOut, readUnsubToken } from "@/lib/email/unsubscribe";

/**
 * POST /api/email/unsubscribe?t=<signed token>
 *
 * Two callers:
 * 1. Gmail / Yahoo / Apple Mail, when someone presses the Unsubscribe button next to our name (RFC 8058).
 *    It is a server-to-server POST with body "List-Unsubscribe=One-Click" and no Origin header, so this
 *    route deliberately skips route()'s same-origin check. The signed token is the whole credential: it can
 *    only remove that one address from that one list. Must answer 2xx without a redirect or a login.
 * 2. Our own /unsubscribe page's form (action=out|in), which then goes back to the page to show the result.
 *
 * Also exempt from maintenance and waitlist mode: an unsubscribe must always work.
 */
export async function POST(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t");
  // One-click POSTs come from Gmail's/Yahoo's servers, so many people share one IP: the per-IP cap is loose
  // and the real limit is per link (the token is already a per-address credential).
  const ip = await limitShared(`${clientIp(req)}:unsub`, 600, 60_000);
  const rl = ip.ok ? await limitShared(`unsub:${sha256(t ?? "")}`, 10, 60_000) : ip;
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const who = readUnsubToken(t);
  if (!who) return NextResponse.json({ error: "This unsubscribe link is not valid." }, { status: 400 });

  const type = req.headers.get("content-type") ?? "";
  const form = type.includes("form") ? await req.formData().catch(() => null) : null;
  const action = form?.get("action") === "in" ? "in" : "out";
  if (action === "in") await optIn(who.email, who.list);
  else await optOut(who.email, who.list);

  // The one-click POST carries List-Unsubscribe=One-Click and wants a plain 200. Our page's form wants to go back.
  // Only our own page sends `action`; anything else (any mail provider) gets a plain 2xx, never a redirect.
  if (form?.has("action")) {
    return NextResponse.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(t!)}&done=${action}`, process.env.APP_URL || req.nextUrl.origin), 303);
  }
  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";
