import "server-only";
import { lookup } from "node:dns/promises";
import { blockedHostReason } from "./public-host";

/** Swappable so tests can fake DNS. Production always uses the system resolver. */
export const resolver = {
  lookup: (host: string): Promise<{ address: string }[]> => lookup(host, { all: true, verbatim: true }),
};

/**
 * SSRF guard, network part: resolves the host and refuses it when ANY address it resolves to is private,
 * so a public-looking name that points at 10.x or 169.254.169.254 is caught too. Call it right before
 * fetching an admin-settable URL, and fetch with redirect: "error" so a 30x can't hop somewhere private.
 * Residual risk, on purpose: fetch resolves the name again, so a DNS-rebinding host could still switch to a
 * private IP between this check and the connect. Closing that needs a pinned-IP agent. URLs here are admin-set.
 */
export async function assertPublicUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That URL isn't valid.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https URLs are allowed.");
  const literal = blockedHostReason(u.hostname);
  if (literal) throw new Error(`Refused: ${u.hostname} is ${literal}.`);
  const addrs = await resolver.lookup(u.hostname.replace(/^\[|\]$/g, "")).catch(() => [] as { address: string }[]);
  if (!addrs.length) throw new Error(`Could not resolve ${u.hostname}.`);
  for (const a of addrs) {
    const why = blockedHostReason(a.address);
    if (why) throw new Error(`Refused: ${u.hostname} resolves to ${why}.`);
  }
}
