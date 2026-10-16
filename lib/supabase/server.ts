import "server-only";
import { env } from "../env";

/**
 * Minimal server-side Supabase client over REST (Storage + Auth). The secret key never leaves the server.
 * We call the REST APIs directly instead of pulling supabase-js into every route.
 */
export class SupabaseError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export function supabaseConfigured() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

function base() {
  if (!supabaseConfigured()) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY).");
  return env.SUPABASE_URL.replace(/\/$/, "");
}

function adminHeaders(extra: Record<string, string> = {}) {
  return { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, ...extra };
}

export async function sbFetch(path: string, init: RequestInit & { asAdmin?: boolean; anon?: boolean } = {}) {
  const { asAdmin = true, anon = false, headers, ...rest } = init;
  const h: Record<string, string> = anon
    ? { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ...(headers as Record<string, string>) }
    : asAdmin
      ? adminHeaders(headers as Record<string, string>)
      : (headers as Record<string, string>);
  return fetch(`${base()}${path}`, { ...rest, headers: h, cache: "no-store" });
}

async function ok<T>(r: Response, what: string): Promise<T> {
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!r.ok) {
    const b = body as { message?: string; msg?: string; error_description?: string; error?: string };
    throw new SupabaseError(r.status, `${what}: ${b?.message ?? b?.msg ?? b?.error_description ?? b?.error ?? r.statusText}`, body);
  }
  return body as T;
}

/* ---------------- Storage ---------------- */

const enc = (key: string) => key.split("/").map(encodeURIComponent).join("/");

export const sbStorage = {
  bucket: () => env.SUPABASE_BUCKET,
  /** One-time token the browser uses to upload exactly this key (simple PUT or TUS). Valid ~2h. */
  async createSignedUpload(key: string) {
    const r = await sbFetch(`/storage/v1/object/upload/sign/${env.SUPABASE_BUCKET}/${enc(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await ok<{ url: string; token: string }>(r, "signed upload");
    return { token: j.token, url: `${base()}/storage/v1${j.url}` };
  },
  async signedUrl(key: string, ttlSec: number) {
    const r = await sbFetch(`/storage/v1/object/sign/${env.SUPABASE_BUCKET}/${enc(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: ttlSec }),
    });
    const j = await ok<{ signedURL: string }>(r, "signed url");
    return `${base()}/storage/v1${j.signedURL}`;
  },
  /** Many keys in one request. Missing objects come back as null instead of failing the batch. */
  async signedUrls(keys: string[], ttlSec: number): Promise<Map<string, string | null>> {
    const r = await sbFetch(`/storage/v1/object/sign/${env.SUPABASE_BUCKET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: ttlSec, paths: keys }),
    });
    const rows = await ok<{ path: string; signedURL: string | null; error: string | null }[]>(r, "signed urls");
    const out = new Map<string, string | null>();
    for (const row of rows) out.set(row.path, row.signedURL && !row.error ? `${base()}/storage/v1${row.signedURL}` : null);
    return out;
  },
  async put(key: string, body: Buffer, contentType: string) {
    const r = await sbFetch(`/storage/v1/object/${env.SUPABASE_BUCKET}/${enc(key)}`, {
      method: "POST",
      headers: { "content-type": contentType, "x-upsert": "true" },
      body: new Uint8Array(body),
    });
    await ok(r, "storage put");
  },
  async get(key: string, range?: { start: number; end: number }) {
    const r = await sbFetch(`/storage/v1/object/authenticated/${env.SUPABASE_BUCKET}/${enc(key)}`, {
      headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
    });
    if (!r.ok || !r.body) throw new SupabaseError(r.status, `storage get ${key}: ${r.status}`);
    return r;
  },
  async info(key: string): Promise<{ size: number; mimetype?: string } | null> {
    const r = await sbFetch(`/storage/v1/object/info/authenticated/${env.SUPABASE_BUCKET}/${enc(key)}`);
    if (r.status === 404 || r.status === 400) return null;
    const j = await ok<{ size?: number; metadata?: { size?: number; mimetype?: string } }>(r, "storage info");
    const size = j.size ?? j.metadata?.size;
    return typeof size === "number" ? { size, mimetype: j.metadata?.mimetype } : null;
  },
  async remove(keys: string[]) {
    const r = await sbFetch(`/storage/v1/object/${env.SUPABASE_BUCKET}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: keys }),
    });
    await ok(r, "storage remove");
  },
  async bucketInfo() {
    const r = await sbFetch(`/storage/v1/bucket/${env.SUPABASE_BUCKET}`);
    return ok<{ file_size_limit: number | null; public: boolean; allowed_mime_types: string[] | null }>(r, "bucket info");
  },
};

/* ---------------- Auth ---------------- */

export interface SbUser {
  id: string;
  email: string;
  user_metadata?: { name?: string };
}

export const sbAuth = {
  /** Server-side signup. Email is confirmed by the admin API so the creator can start immediately (no SMTP needed). */
  async createUser(email: string, password: string, name: string) {
    const r = await sbFetch(`/auth/v1/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
    });
    return ok<SbUser>(r, "auth signup");
  },
  async signIn(email: string, password: string) {
    const r = await sbFetch(`/auth/v1/token?grant_type=password`, {
      method: "POST",
      anon: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return ok<{ access_token: string; user: SbUser }>(r, "auth sign in");
  },
  async findByEmail(email: string): Promise<SbUser | null> {
    // GoTrue admin list has no exact email filter on every version; page through (fine for MVP volumes).
    for (let page = 1; page <= 20; page++) {
      const r = await sbFetch(`/auth/v1/admin/users?page=${page}&per_page=200`);
      const j = await ok<{ users: SbUser[] }>(r, "auth list");
      const hit = j.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (hit) return hit;
      if (j.users.length < 200) return null;
    }
    return null;
  },
  /** Permanently remove the auth user. Used when a creator deletes their studio. */
  async deleteUser(id: string) {
    const r = await sbFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 404) return; // already gone
    await ok(r, "auth delete");
  },
  async updatePassword(id: string, password: string) {
    const r = await sbFetch(`/auth/v1/admin/users/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    return ok<SbUser>(r, "auth update");
  },
};
