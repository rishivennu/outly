import "server-only";
import { cookies } from "next/headers";
import { decrypt, encrypt, safeEqual } from "./crypto";
import { env } from "./env";
import type { Platform } from "./domain";

interface Pending {
  state: string;
  verifier?: string;
  returnTo: string;
  /** "login": this Google consent also signs the creator in (Continue with Google). */
  mode?: "connect" | "login";
  exp: number;
}
const name = (p: Platform) => `oauth_${p}`;

export function saveOAuthState(p: Platform, v: Omit<Pending, "exp">) {
  cookies().set(name(p), encrypt(JSON.stringify({ ...v, exp: Date.now() + 10 * 60_000 })), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/accounts",
    maxAge: 600,
  });
}

export function takeOAuthState(p: Platform, state: string | null): Pending | null {
  const raw = cookies().get(name(p))?.value;
  cookies().delete({ name: name(p), path: "/api/accounts" });
  if (!raw || !state) return null;
  try {
    const v = JSON.parse(decrypt(raw)) as Pending;
    return v.exp > Date.now() && safeEqual(v.state, state) ? v : null;
  } catch {
    return null;
  }
}

export function safeReturnTo(v: string | null) {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/accounts";
}
