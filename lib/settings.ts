import "server-only";
import { db } from "./db";
import { LANDING_DEFAULT } from "./landing";
import { MASCOT_DEFAULT, type MascotConfig } from "./mascot/palettes";
import { encrypt, decrypt } from "./crypto";
import { UPDATE_DEFAULT, type UpdateNotice } from "./updates";
import { PRICING_DISPLAY_DEFAULT, type PricingDisplay } from "./billing/display";
import { YOUPI_DEFAULT, type YoupiConfig } from "./billing/youpi";
import { BETA_DEFAULT, type BetaConfig } from "./beta-config";

/**
 * Integration config lives in the DB so the admin can switch providers without a deploy.
 * Secret fields are encrypted at rest (AES-256-GCM, same key as social tokens) and are
 * never returned to the browser: the admin UI only ever sees "•••• last4".
 */
export type PaymentProvider = "mock" | "stripe" | "razorpay" | "paypal" | "youpi";
export type EmailProvider = "mock" | "resend";

export interface PaymentConfig {
  provider: PaymentProvider;
  mode: "test" | "live";
  stripe: { publishableKey: string; secretKey: string; webhookSecret: string };
  razorpay: { keyId: string; keySecret: string; webhookSecret: string };
  paypal: { clientId: string; clientSecret: string; webhookId: string };
  /** Self-hosted UPI gateway (YOUPI PG). */
  youpi: YoupiConfig;
  business: { name: string; address: string; gstin: string; taxPercent: number };
}
/** Every platform, keyed the same way so the admin form and the registry stay generic. */
export const KEYED_PLATFORMS = ["instagram", "youtube", "x", "tiktok", "facebook", "threads", "linkedin"] as const;
export type KeyedPlatform = (typeof KEYED_PLATFORMS)[number];
/** `dms` (Instagram and Facebook only, 1031f): false = don't ask for the messaging permissions. Unset = on. */
export type PlatformKeys = Record<KeyedPlatform, { clientId: string; clientSecret: string; dms?: boolean }>;

export interface SiteConfig {
  maintenance: boolean;
  message: string;
  /** Free text shown on the page, e.g. "about 30 minutes". */
  eta: string;
  since: string;
  /** When maintenance should be over (ISO), set from the admin's duration picker. Drives the live countdown. "" = no countdown. */
  endsAt: string;
  /** Waitlist mode: new signups are paused, visitors join a queue, the admin invites them in. */
  waitlist: boolean;
  waitlistSince: string;
}

export interface EmailConfig {
  provider: EmailProvider;
  /** Sender for account email: sign-in codes, security alerts, invoices, support. Use the mail. subdomain. */
  from: string;
  /** Sender for marketing email (nudges, win-back, growth, weekly report), on its own subdomain so a spam
   *  complaint there can't drag sign-in codes into the junk folder. "" = use `from`. */
  marketingFrom: string;
  replyTo: string;
  resend: { apiKey: string };
}

const SECRET_PATHS: Record<string, string[]> = {
  payments: ["stripe.secretKey", "stripe.webhookSecret", "razorpay.keySecret", "razorpay.webhookSecret", "paypal.clientSecret", "youpi.webhookSecret"],
  platforms: ["instagram", "youtube", "x", "tiktok", "facebook", "threads", "linkedin"].map((p) => `${p}.clientSecret`),
  email: ["resend.apiKey"],
};

export const DEFAULTS = {
  payments: {
    provider: "mock",
    mode: "test",
    stripe: { publishableKey: "", secretKey: "", webhookSecret: "" },
    razorpay: { keyId: "", keySecret: "", webhookSecret: "" },
    paypal: { clientId: "", clientSecret: "", webhookId: "" },
    youpi: { ...YOUPI_DEFAULT },
    business: { name: "Outlly", address: "Bengaluru, India", gstin: "", taxPercent: 0 },
  } as PaymentConfig,
  email: { provider: "mock", from: "Outlly <hello@mail.outlly.com>", marketingFrom: "", replyTo: "", resend: { apiKey: "" } } as EmailConfig,
  site: { maintenance: false, message: "", eta: "", since: "", endsAt: "", waitlist: false, waitlistSince: "" } as SiteConfig,
  landing: LANDING_DEFAULT,
  pricing: PRICING_DISPLAY_DEFAULT as PricingDisplay,
  mascot: MASCOT_DEFAULT as MascotConfig,
  updates: UPDATE_DEFAULT as UpdateNotice,
  beta: BETA_DEFAULT as BetaConfig,
  platforms: Object.fromEntries(["instagram", "youtube", "x", "tiktok", "facebook", "threads", "linkedin"].map((p) => [p, { clientId: "", clientSecret: "" }])) as PlatformKeys,
};
type Key = keyof typeof DEFAULTS;
type Cfg<K extends Key> = (typeof DEFAULTS)[K];

const get = (o: any, p: string) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o: any, p: string, v: unknown) => {
  const ks = p.split(".");
  let c = o;
  for (const k of ks.slice(0, -1)) c = c[k] ??= {};
  c[ks[ks.length - 1]] = v;
};
function merge<T>(base: T, over: any): T {
  if (!over || typeof over !== "object") return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const k of Object.keys(over)) {
    const b = (base as any)?.[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, over[k]) : over[k];
  }
  return out;
}

// 15 s in-process cache: config is read on every checkout / email, written rarely.
const g = globalThis as unknown as { __cfg?: Map<string, { at: number; v: unknown }> };
const cache = (g.__cfg ??= new Map());

export async function getConfig<K extends Key>(key: K): Promise<Cfg<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.v as Cfg<K>;
  const row = await db.setting.findUnique({ where: { key } });
  let v: any = structuredClone(DEFAULTS[key]);
  if (row) {
    try {
      const stored = JSON.parse(row.value);
      for (const p of SECRET_PATHS[key] ?? []) {
        const enc = get(stored, p);
        if (typeof enc === "string" && enc) {
          try {
            set(stored, p, decrypt(enc));
          } catch {
            set(stored, p, ""); // key rotated: treat as unset, admin re-enters
          }
        }
      }
      v = merge(v, stored);
    } catch {
      /* corrupt row: fall back to defaults (mock) rather than crash checkout */
    }
  }
  cache.set(key, { at: Date.now(), v });
  return v as Cfg<K>;
}

/**
 * Saves a partial update. A secret field sent as "" or omitted keeps its current value;
 * send `null` to clear it. That way the masked form can be saved without re-typing keys.
 */
export async function saveConfig<K extends Key>(key: K, patch: any): Promise<Cfg<K>> {
  const cur: any = await getConfig(key);
  const next: any = merge(cur, patch);
  for (const p of SECRET_PATHS[key] ?? []) {
    const incoming = get(patch, p);
    if (incoming === undefined || incoming === "") set(next, p, get(cur, p) ?? "");
    else if (incoming === null) set(next, p, "");
  }
  const stored = structuredClone(next);
  for (const p of SECRET_PATHS[key] ?? []) {
    const v = get(stored, p);
    set(stored, p, v ? encrypt(String(v)) : "");
  }
  await db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(stored) }, update: { value: JSON.stringify(stored) } });
  cache.delete(key);
  return next;
}

/** Browser-safe view: secrets become { set, last4 }. */
export function redact<K extends Key>(key: K, cfg: Cfg<K>) {
  const out: any = structuredClone(cfg);
  for (const p of SECRET_PATHS[key] ?? []) {
    const v = String(get(cfg, p) ?? "");
    set(out, p, v ? { set: true, last4: v.slice(-4) } : { set: false, last4: "" });
  }
  return out;
}
