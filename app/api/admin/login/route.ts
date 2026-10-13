import { type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, clientIp, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminSession, verifyAdminLogin } from "@/lib/admin/auth";

const Body = z.object({ login: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
  } catch {
    return json({ error: "Blocked." }, { status: 403 });
  }
  const ip = clientIp(req);
  // 6 attempts per 15 min per IP: a 4-digit PIN needs this, or it falls in minutes.
  const rl = rateLimit(`admin-login:${ip}`, 6, 15 * 60_000);
  if (!rl.ok) return json({ error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} min.`, code: "RATE_LIMITED" }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return json({ error: "Enter your admin login and password." }, { status: 400 });
  // Second limiter per login name, so a botnet rotating IPs still can't brute-force one account.
  const rlUser = rateLimit(`admin-login-user:${p.data.login.toLowerCase()}`, 20, 60 * 60_000);
  if (!rlUser.ok) return json({ error: "This login is locked for a while after too many attempts. Try again later.", code: "RATE_LIMITED" }, { status: 429 });
  const a = await verifyAdminLogin(p.data.login, p.data.password);
  if (!a) return json({ error: "That login and password don't match." }, { status: 401 });
  await createAdminSession(a);
  return json({ ok: true, role: a.role });
}
