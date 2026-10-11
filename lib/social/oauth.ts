import { createHash, randomBytes } from "node:crypto";

export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
export const newState = () => randomBytes(24).toString("base64url");

export async function formPost(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body),
  });
}
