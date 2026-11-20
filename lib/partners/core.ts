import { PARTNER_PLATFORMS, tierFor, type PartnerPlatform, type PartnerProposal, type PartnerSocial, type PartnerStats, type PartnerTier } from "./types";

/** No 0/O, 1/I/L: the creator reads the ID out of an email and may type it back. */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REF_RE = /^OP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

function randomChars(n: number, alphabet: string) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  // 256 is not a multiple of the alphabet length; the bias is a fraction of a percent and harmless for an ID.
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const makeRef = () => `OP-${randomChars(6, REF_ALPHABET)}`;

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const FILE_TOKEN_RE = /^[A-Za-z0-9]{24}$/;
export const makeFileToken = () => randomChars(24, TOKEN_ALPHABET);

/** One key per inbox: case, gmail dots, googlemail.com and +tags all fold away, so a second address for the same inbox is caught. */
export function emailKeyOf(email: string) {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0] || local;
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");

export const PLATFORM_HOSTS: Record<PartnerPlatform, string[]> = {
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  facebook: ["facebook.com", "fb.com"],
  threads: ["threads.net", "threads.com"],
  other: [],
};

export const HANDLE_RULES: Record<PartnerPlatform, { re: RegExp; hint: string }> = {
  instagram: { re: /^[A-Za-z0-9._]{1,30}$/, hint: "Use letters, numbers, dots or underscores, up to 30 characters" },
  youtube: { re: /^[A-Za-z0-9._-]{3,100}$/, hint: "Use your YouTube handle: letters, numbers, dots, dashes or underscores" },
  tiktok: { re: /^[A-Za-z0-9._]{2,24}$/, hint: "Use letters, numbers, dots or underscores, 2 to 24 characters" },
  x: { re: /^[A-Za-z0-9_]{1,15}$/, hint: "Use letters, numbers or underscores, up to 15 characters" },
  linkedin: { re: /^[A-Za-z0-9-]{3,100}$/, hint: "Use the part after linkedin.com/in/: letters, numbers or dashes" },
  facebook: { re: /^[A-Za-z0-9.-]{2,50}$/, hint: "Use the page or profile name from your Facebook link" },
  threads: { re: /^[A-Za-z0-9._]{1,30}$/, hint: "Use letters, numbers, dots or underscores, up to 30 characters" },
  other: { re: /^[^\s<>]{1,60}$/, hint: "Use your username without spaces" },
};

const isPlatform = (p: string): p is PartnerPlatform => (PARTNER_PLATFORMS as readonly string[]).includes(p);

const hostMatches = (platform: PartnerPlatform, host: string) => {
  const h = host.toLowerCase();
  return PLATFORM_HOSTS[platform].some((d) => h === d || h.endsWith(`.${d}`));
};

/** Looks like a link rather than a handle: has a scheme, a slash, or ends in a known host. */
function looksLikeUrl(platform: PartnerPlatform, s: string) {
  if (/^https?:\/\//i.test(s) || s.includes("/")) return true;
  if (platform === "other") return /\.[a-z]{2,}$/i.test(s);
  return PLATFORM_HOSTS[platform].some((d) => s.toLowerCase() === d || s.toLowerCase().endsWith(`.${d}`));
}

function parseUrl(s: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

function handleFromPath(platform: PartnerPlatform, u: URL) {
  const parts = u.pathname.split("/").filter(Boolean);
  if (platform === "linkedin") return parts[0] === "in" || parts[0] === "company" ? (parts[1] ?? "") : "";
  if (platform === "youtube" && ["c", "user", "channel"].includes(parts[0] ?? "")) return parts[1] ?? "";
  return (parts[0] ?? "").replace(/^@/, "");
}

/** "@ria.creates", "ria.creates" or "https://instagram.com/ria.creates/" -> "ria.creates". */
export function normaliseHandle(platform: string, input: string) {
  const s = input.trim();
  if (!s || !isPlatform(platform)) return s.replace(/^@+/, "");
  if (platform !== "other" && looksLikeUrl(platform, s)) {
    const u = parseUrl(s);
    if (u && hostMatches(platform, u.hostname)) return handleFromPath(platform, u);
  }
  return s.replace(/^@+/, "");
}

export const validHandle = (platform: string, handle: string) => isPlatform(platform) && HANDLE_RULES[platform].re.test(handle);

export function profileUrlFor(platform: string, handle: string) {
  const h = handle.replace(/^@+/, "");
  if (!h || !validHandle(platform, h)) return "";
  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/${h}/`;
    case "youtube":
      return `https://www.youtube.com/@${h}`;
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "x":
      return `https://x.com/${h}`;
    case "linkedin":
      return `https://www.linkedin.com/in/${h}`;
    case "facebook":
      return `https://www.facebook.com/${h}`;
    case "threads":
      return `https://www.threads.net/@${h}`;
    default:
      return "";
  }
}

/**
 * The canonical https profile link for a handle or a pasted link, or null when it is not a link to that platform.
 * Query strings and fragments go (they are usually share trackers); "other" accepts any https host with a dot.
 */
export function normaliseProfileUrl(platform: string, input: string): string | null {
  const s = input.trim();
  if (!s || !isPlatform(platform) || /\s/.test(s)) return null;
  if (!looksLikeUrl(platform, s)) return profileUrlFor(platform, s) || null;
  const u = parseUrl(s);
  if (!u || !/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (platform === "other") {
    if (!/\.[a-z]{2,}$/i.test(u.hostname)) return null;
  } else if (!hostMatches(platform, u.hostname)) return null;
  u.protocol = "https:";
  u.hash = "";
  if (platform !== "other" && !(platform === "youtube" && u.hostname.endsWith("youtu.be"))) u.search = "";
  if (platform !== "other" && u.pathname.replace(/\//g, "") === "") return null;
  return u.toString();
}

export interface PartnerSummary {
  primaryPlatform: string;
  primaryHandle: string;
  followers: number;
  avgViews: number;
  engagementRate: number | null;
  niche: string;
  tier: PartnerTier;
  preference: string;
}

/** The denormalised columns the admin table sorts and filters on. Followers = the largest account. */
export function summarise(app: { socials: PartnerSocial[]; stats: PartnerStats; proposal: Pick<PartnerProposal, "preference"> }): PartnerSummary {
  const primary = app.socials.find((s) => s.primary) ?? app.socials[0];
  const followers = app.socials.reduce((m, s) => Math.max(m, Math.max(0, Math.floor(s.followers || 0))), 0);
  return {
    primaryPlatform: primary?.platform ?? "",
    primaryHandle: primary?.handle ?? "",
    followers,
    avgViews: Math.max(0, Math.floor(app.stats.avgViews || 0)),
    engagementRate: app.stats.engagementRate ?? null,
    niche: app.stats.niche || primary?.niche || "",
    tier: tierFor(followers),
    preference: app.proposal.preference,
  };
}

/** Upload names shown to admins: safe characters only, at most 80. */
export function cleanFileName(name: string) {
  const n = name.replace(/[^A-Za-z0-9._ -]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return n || "file";
}

export const FILE_EXT: Record<string, "png" | "jpg" | "pdf"> = { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };
export const pendingFileKey = (token: string, ext: string) => `partners/pending/${token}.${ext}`;

/** Magic bytes, never the browser's claimed type: PNG 89504E47, JPEG FFD8FF, PDF 25504446 ("%PDF"). */
export function sniffMime(b: Uint8Array): "image/png" | "image/jpeg" | "application/pdf" | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}
