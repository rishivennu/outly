/**
 * Approximate location from the network (1053). Pure: tested in tests/round-1053-location.test.ts.
 *
 * Cloudflare (in front of www.outlly.com) sends CF-IPCountry always, and CF-Region / CF-IPCity when the
 * "visitor location headers" managed transform is on. Vercel sends x-vercel-ip-*. No lookup service is
 * called, so reading it costs nothing. It is the network's location, not the person's: a VPN, a corporate
 * proxy or a mobile carrier can put them in another city or country, so it is always shown as approximate.
 */

export type IpPlace = { country: string | null; region: string | null; city: string | null; via: "cloudflare" | "vercel" | "tor" };

const text = (v: string | null | undefined) => {
  if (!v) return null;
  let s = v;
  try {
    s = decodeURIComponent(v); // Vercel URL-encodes city names ("S%C3%A3o%20Paulo")
  } catch {
    /* keep as sent */
  }
  s = s.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  return s || null;
};
const iso = (v: string | null | undefined) => {
  const c = (v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" ? c : null;
};

export function ipPlace(get: (name: string) => string | null | undefined): IpPlace | null {
  const cf = (get("cf-ipcountry") ?? "").trim().toUpperCase();
  if (cf === "T1") return { country: null, region: null, city: null, via: "tor" }; // Tor exit: no real place
  const vc = iso(get("x-vercel-ip-country"));
  const vRegion = text(get("x-vercel-ip-country-region"));
  const vCity = text(get("x-vercel-ip-city"));
  const c = iso(cf);
  if (c) {
    // Behind Cloudflare, Vercel may be locating Cloudflare's own server: only borrow its city when the countries agree.
    const agree = vc === c;
    return { country: c, region: text(get("cf-region")) ?? (agree ? vRegion : null), city: text(get("cf-ipcity")) ?? (agree ? vCity : null), via: "cloudflare" };
  }
  if (vc) return { country: vc, region: vRegion, city: vCity, via: "vercel" };
  return null; // unknown (local dev, XX, a header-less proxy): keep whatever was known before
}

/** Same place? Used to write only when it changes. */
export const placeKey = (p: IpPlace | null) => (p ? `${p.via}|${p.country ?? ""}|${p.region ?? ""}|${p.city ?? ""}` : "");

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** "Hyderabad, Telangana, India". Never more exact than a city. */
export function placeLabel(p: { country?: string | null; region?: string | null; city?: string | null; via?: string | null } | null): string | null {
  if (!p) return null;
  if (p.via === "tor") return "Tor network (location hidden)";
  if (!p.country) return null;
  const parts = [p.city, p.region && p.region !== p.city ? p.region : null, countryName(p.country)].filter(Boolean);
  return [...new Set(parts)].join(", ");
}

// Time zones that belong to one country, for a gentle "this may be a VPN" hint (never a verdict).
const TZ_COUNTRY: Record<string, string> = {
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dubai": "AE", "Asia/Singapore": "SG", "Asia/Tokyo": "JP", "Asia/Karachi": "PK", "Asia/Dhaka": "BD", "Asia/Kathmandu": "NP", "Asia/Colombo": "LK", "Asia/Jakarta": "ID", "Asia/Manila": "PH", "Asia/Bangkok": "TH", "Asia/Riyadh": "SA", "Asia/Hong_Kong": "HK", "Asia/Seoul": "KR",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Amsterdam": "NL",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Toronto": "CA", "America/Vancouver": "CA", "America/Sao_Paulo": "BR", "America/Mexico_City": "MX",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Pacific/Auckland": "NZ", "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Africa/Johannesburg": "ZA",
};

/** True when the network's country and the person's own time zone clearly disagree (VPN, proxy, travel). */
export function looksRelayed(country: string | null | undefined, timezone: string | null | undefined): boolean {
  const tzc = timezone ? TZ_COUNTRY[timezone] : undefined;
  return !!(country && tzc && tzc !== country);
}

/** "Chrome on Android". Coarse on purpose: a label for a list, not a fingerprint. */
export function deviceLabel(ua: string | null | undefined): string {
  const u = ua ?? "";
  const os = /Android/i.test(u) ? "Android" : /iPhone|iPad|iPod/i.test(u) ? "iPhone or iPad" : /Mac OS X|Macintosh/i.test(u) ? "Mac" : /Windows/i.test(u) ? "Windows" : /CrOS/i.test(u) ? "ChromeOS" : /Linux/i.test(u) ? "Linux" : null;
  const br = /OutllyApp|; wv\)/i.test(u) ? "Outlly app" : /Edg\//i.test(u) ? "Edge" : /OPR\/|Opera/i.test(u) ? "Opera" : /SamsungBrowser/i.test(u) ? "Samsung Internet" : /Firefox\/|FxiOS/i.test(u) ? "Firefox" : /Chrome\/|CriOS/i.test(u) ? "Chrome" : /Safari\//i.test(u) ? "Safari" : null;
  if (br && os) return `${br} on ${os}`;
  return br ?? os ?? "A browser";
}
