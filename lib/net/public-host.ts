/**
 * SSRF guard, pure part. An admin-settable URL (FunASR worker, YOUPI gateway) must never point the server
 * at itself, the private network or the cloud metadata service (169.254.169.254 hands out cloud keys).
 * Returns why a host is refused, or null when it is a public host. No DNS here: see assertPublicUrl.
 */
const NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

function v4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

function v4Reason([a, b]: number[]): string | null {
  if (a === 0 || a === 10 || a === 127) return "a private or loopback address";
  if (a === 169 && b === 254) return "a link-local address (cloud metadata lives here)";
  if (a === 172 && b >= 16 && b <= 31) return "a private address";
  if (a === 192 && b === 168) return "a private address";
  if (a === 100 && b >= 64 && b <= 127) return "a carrier-grade NAT address";
  if (a === 192 && b === 0) return "a reserved address";
  if (a === 198 && (b === 18 || b === 19)) return "a benchmark address";
  if (a >= 224) return "a multicast or reserved address";
  return null;
}

export function blockedHostReason(hostname: string): string | null {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return "an empty host";
  const four = v4(h);
  if (four) return v4Reason(four);
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return "a loopback address";
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return v4(mapped[1]) ? v4Reason(v4(mapped[1])!) : "a malformed address";
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return "an IPv4-mapped address";
    // IPv4 tucked inside IPv6: deprecated ::a.b.c.d, NAT64 (64:ff9b::/96 and 64:ff9b:1::/48) and 6to4 (2002::/16)
    if (/^::[0-9a-f]{1,4}(:[0-9a-f]{1,4})?$/.test(h)) return "an IPv4-compatible address";
    if (/^64:ff9b:/.test(h)) return "a NAT64 address that can reach IPv4 inside the network";
    if (/^2002:/.test(h)) return "a 6to4 address that can wrap a private IPv4";
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return "a private IPv6 address";
    if (/^fe[89ab][0-9a-f]:/.test(h)) return "a link-local IPv6 address";
    if (/^ff[0-9a-f]{2}:/.test(h)) return "a multicast IPv6 address";
    return null;
  }
  if (!h.includes(".")) return "a single-label name that only resolves inside a private network";
  if (NAMES.test(h) || h === "metadata.google.internal") return "an internal name";
  return null;
}
