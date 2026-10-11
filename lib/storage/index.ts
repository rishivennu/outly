import "server-only";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AwsClient } from "aws4fetch";
import { env } from "../env";
import { hmac, safeEqual } from "../crypto";
import { sbStorage } from "../supabase/server";

/**
 * Private object storage. Nothing is publicly addressable: the browser only ever
 * receives short-lived signed URLs, and only after an ownership check.
 */
export interface StorageDriver {
  put(key: string, body: ReadableStream<Uint8Array> | Buffer, contentType: string, maxBytes?: number): Promise<{ size: number }>;
  /** Short-lived URL the browser (or a platform like Instagram) can fetch. */
  signedUrl(key: string, ttlSec?: number): Promise<string>;
  read(key: string, range?: { start: number; end: number }): Promise<{ stream: Readable; size: number }>;
  stat(key: string): Promise<{ size: number } | null>;
  localPath?(key: string): string;
  remove(key: string): Promise<void>;
  /** Present when the browser can upload straight to the bucket (no bytes through our server). */
  createDirectUpload?(key: string): Promise<{ token: string; url: string; resumableUrl: string }>;
  readonly name: "local" | "s3" | "supabase";
}

export class UploadTooLargeError extends Error {}

const ROOT = resolve(process.cwd(), "storage");

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const p = resolve(ROOT, key);
  if (!p.startsWith(ROOT + sep)) throw new Error("Invalid storage key");
  return p;
}

export function signKey(key: string, exp: number) {
  return hmac(`${key}:${exp}`);
}
export function verifySignedKey(key: string, exp: number, sig: string) {
  return exp > Date.now() / 1000 && safeEqual(signKey(key, exp), sig);
}

const local: StorageDriver = {
  name: "local",
  async put(key, body, _ct, maxBytes) {
    const p = safeKey(key);
    mkdirSync(dirname(p), { recursive: true });
    if (Buffer.isBuffer(body)) {
      if (maxBytes && body.length > maxBytes) throw new UploadTooLargeError();
      await pipeline(Readable.from(body), createWriteStream(p));
      return { size: body.length };
    }
    let size = 0;
    const src = Readable.fromWeb(body as never);
    src.on("data", (c: Buffer) => {
      size += c.length;
      if (maxBytes && size > maxBytes) src.destroy(new UploadTooLargeError());
    });
    try {
      await pipeline(src, createWriteStream(p));
    } catch (e) {
      rmSync(p, { force: true });
      throw e;
    }
    return { size };
  },
  async signedUrl(key, ttlSec = 3600) {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    return `/api/files/${key}?exp=${exp}&sig=${signKey(key, exp)}`;
  },
  async read(key, range) {
    const p = safeKey(key);
    const size = statSync(p).size;
    return { stream: createReadStream(p, range), size };
  },
  async stat(key) {
    const p = safeKey(key);
    return existsSync(p) ? { size: statSync(p).size } : null;
  },
  localPath: (key) => safeKey(key),
  async remove(key) {
    rmSync(safeKey(key), { force: true });
  },
};

function s3(): StorageDriver {
  const aws = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION,
    service: "s3",
  });
  const url = (key: string) => `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`;
  return {
    name: "s3",
    async put(key, body, contentType, maxBytes) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(await new Response(body).arrayBuffer());
      if (maxBytes && buf.length > maxBytes) throw new UploadTooLargeError();
      const r = await aws.fetch(url(key), { method: "PUT", body: buf, headers: { "content-type": contentType } });
      if (!r.ok) throw new Error(`S3 put failed: ${r.status}`);
      return { size: buf.length };
    },
    async signedUrl(key, ttlSec = 3600) {
      const signed = await aws.sign(`${url(key)}?X-Amz-Expires=${ttlSec}`, { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },
    async read(key, range) {
      const headers: Record<string, string> = {};
      if (range) headers.range = `bytes=${range.start}-${range.end}`;
      const r = await aws.fetch(url(key), { headers });
      if (!r.ok || !r.body) throw new Error(`S3 get failed: ${r.status}`);
      return { stream: Readable.fromWeb(r.body as never), size: Number(r.headers.get("content-length") ?? 0) };
    },
    async stat(key) {
      const r = await aws.fetch(url(key), { method: "HEAD" });
      return r.ok ? { size: Number(r.headers.get("content-length") ?? 0) } : null;
    },
    async remove(key) {
      await aws.fetch(url(key), { method: "DELETE" });
    },
  };
}

const signCache = new Map<string, { url: string | null; exp: number }>();
const MISSING_TTL_MS = 60_000;

/*
 * Request coalescing for signed URLs. A page that renders 30 thumbnails asks for 30
 * URLs in the same tick; instead of 30 sequential round-trips to Supabase they are
 * collected for one macrotask and signed in a single batch call. Concurrent asks
 * for the same key share one promise, and a key that does not exist is remembered
 * as missing for a minute so a broken thumbnail does not cost a request per render.
 */
let pending: { keys: Map<string, { resolve: (u: string | null) => void; reject: (e: unknown) => void }[]>; ttl: number } | null = null;
const inflight = new Map<string, Promise<string | null>>();

function flushSoon(ttlSec: number) {
  if (pending) return pending;
  pending = { keys: new Map(), ttl: ttlSec };
  setTimeout(async () => {
    const batch = pending!;
    pending = null;
    const keys = [...batch.keys.keys()];
    try {
      const urls = keys.length === 1 ? new Map([[keys[0], await sbStorage.signedUrl(keys[0], batch.ttl).catch(() => null)]]) : await sbStorage.signedUrls(keys, batch.ttl);
      const now = Date.now();
      for (const k of keys) {
        const url = urls.get(k) ?? null;
        signCache.set(k, { url, exp: url ? now + batch.ttl * 1000 : now + MISSING_TTL_MS });
        batch.keys.get(k)!.forEach((w) => w.resolve(url));
      }
      while (signCache.size > 5000) signCache.delete(signCache.keys().next().value as string);
    } catch (e) {
      for (const k of keys) batch.keys.get(k)!.forEach((w) => w.reject(e));
    }
  }, 0);
  return pending;
}

function signBatched(key: string, ttlSec: number): Promise<string | null> {
  const hit = signCache.get(key);
  const now = Date.now();
  // reuse a URL while it still has >25% of its life left; remember misses briefly
  if (hit && (hit.url ? hit.exp - now > ttlSec * 250 : hit.exp > now)) return Promise.resolve(hit.url);
  const running = inflight.get(key);
  if (running) return running;
  const p = new Promise<string | null>((resolve, reject) => {
    const b = flushSoon(ttlSec);
    const list = b.keys.get(key) ?? [];
    list.push({ resolve, reject });
    b.keys.set(key, list);
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Supabase Storage over its REST API with the server secret key. Bucket is private; reads go through signed URLs. */
function supabase(): StorageDriver {
  return {
    name: "supabase",
    async put(key, body, contentType, maxBytes) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(await new Response(body).arrayBuffer());
      if (maxBytes && buf.length > maxBytes) throw new UploadTooLargeError();
      await sbStorage.put(key, buf, contentType);
      return { size: buf.length };
    },
    async signedUrl(key, ttlSec = 3600) {
      const url = await signBatched(key, ttlSec);
      if (!url) throw new Error(`object not found: ${key}`);
      return url;
    },
    async read(key, range) {
      const r = await sbStorage.get(key, range);
      const total = Number(r.headers.get("content-range")?.split("/")[1] ?? r.headers.get("content-length") ?? 0);
      return { stream: Readable.fromWeb(r.body as never), size: total };
    },
    stat: (key) => sbStorage.info(key),
    async remove(key) {
      signCache.delete(key);
      await sbStorage.remove([key]);
    },
    async createDirectUpload(key) {
      const { token, url } = await sbStorage.createSignedUpload(key);
      return { token, url, resumableUrl: `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/upload/resumable/sign` };
    },
  };
}

export const storage: StorageDriver = env.STORAGE_DRIVER === "supabase" ? supabase() : env.STORAGE_DRIVER === "s3" ? s3() : local;
