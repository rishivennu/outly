import "server-only";
import { cookies } from "next/headers";
import { decrypt, encrypt, safeEqual } from "./crypto";
import { env } from "./env";
import { sameSitePath } from "./safe-next";
import type { Platform } from "./domain";
import type { ConnectIntent } from "./connect-decision";

interface Pending {
  state: string;
  verifier?: string;
  returnTo: string;
  /** "login": this Google consent also signs the creator in (Continue with Google). */
  mode?: "connect" | "login";
  /** Continue with Google: the "Remember this device" choice on the sign-in page (1053). */
  remember?: boolean;
  /** 1095: what the creator asked for: "reconnect" one account (`expect`), a "new" (different) one, or "auto". */
  intent?: ConnectIntent;
  expect?: string | null;
  exp: number;
}
const name = (p: Platform) => `oauth_${p}`;

export async function saveOAuthState(p: Platform, v: Omit<Pending, "exp">) {
  (await cookies()).set(name(p), encrypt(JSON.stringify({ ...v, exp: Date.now() + 10 * 60_000 })), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/accounts",
    maxAge: 600,
  });
}

export async function takeOAuthState(p: Platform, state: string | null): Promise<Pending | null> {
  const raw = (await cookies()).get(name(p))?.value;
  (await cookies()).delete({ name: name(p), path: "/api/accounts" });
  if (!raw || !state) return null;
  try {
    const v = JSON.parse(decrypt(raw)) as Pending;
    return v.exp > Date.now() && safeEqual(v.state, state) ? v : null;
  } catch {
    return null;
  }
}

export function safeReturnTo(v: string | null) {
  // "/\\evil.com" also counts as protocol-relative: new URL() turns the backslash into a slash.
  return sameSitePath(v) ?? "/accounts";
}
