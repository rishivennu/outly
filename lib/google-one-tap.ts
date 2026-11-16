import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { creds } from "@/lib/social/keys";
import { HttpError } from "@/lib/http";

/**
 * Google One Tap: the sign-in prompt Google Identity Services shows on /login and /signup to a visitor who is
 * signed in to Google in this browser. One tap on their account hands the page an ID token; the browser posts it
 * to /api/auth/google/one-tap, which checks it here and signs the studio in (or makes it, 18+ tick applying).
 * It uses the same Google Cloud client as Continue with Google, so there is one place for keys (Admin > Social
 * platforms > YouTube); the site's origin must be listed under that client's Authorised JavaScript origins.
 */
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** The browser side of the OAuth client (public by design). Empty = Google sign-in not set up, no prompt. */
export function oneTapClientId(): string {
  return creds("youtube").clientId;
}

export interface GoogleWho {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Checks Google's signature, issuer, audience (our client ID) and expiry. Anything else is a 401 with a reason the form knows. */
export async function googleOneTapIdentity(credential: string, clientId = oneTapClientId(), keys: JWTVerifyGetKey = googleJwks): Promise<GoogleWho> {
  if (!clientId) throw new HttpError(503, "Google sign-in isn't set up on this server yet.", "not_configured");
  let payload;
  try {
    ({ payload } = await jwtVerify(credential, keys, { issuer: GOOGLE_ISSUERS, audience: clientId, algorithms: ["RS256"] }));
  } catch {
    throw new HttpError(401, "Google signed you in, but we couldn't check that sign-in. Try once more.", "exchange");
  }
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new HttpError(401, "Google signed you in, but we couldn't check that sign-in. Try once more.", "exchange");
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}
