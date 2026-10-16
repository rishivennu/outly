import "server-only";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { makeS3, partBytes, r2Endpoint, type PartInfo, type S3Config } from "./s3x";
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
  createDirectUpload?(key: string, file: { size: number; contentType: string }): Promise<DirectUpload>;
  /** S3/R2 multipart: presigned part URLs, the parts already stored, and the final stitch. */
  multipart?: {
    partSize: number;
    sign(key: string, uploadId: string, size: number, parts: number[]): Promise<Record<number, string>>;
    list(key: string, uploadId: string): Promise<PartInfo[]>;
    complete(key: string, uploadId: string, parts: PartInfo[]): Promise<void>;
    abort(key: string, uploadId: string): Promise<void>;
  };
  readonly name: "local" | "s3" | "r2" | "supabase";
}

export type DirectUpload =
  | { mode: "tus"; token: string; url: string; resumableUrl: string }
  | { mode: "put"; url: string }
  | { mode: "multipart"; uploadId: string; partSize: number };

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

/** S3-compatible bucket (Cloudflare R2 or AWS S3). Private; reads and browser uploads go through presigned URLs. */
export function s3Driver(cfg: S3Config, name: "s3" | "r2", partSize = env.UPLOAD_PART_MB * 1024 * 1024): StorageDriver {
  const c = makeS3(cfg, { pinLength: env.UPLOAD_PIN_LENGTH });
  return {
    name,
    async put(key, body, contentType, maxBytes) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(await new Response(body).arrayBuffer());
      if (maxBytes && buf.length > maxBytes) throw new UploadTooLargeError();
      await c.put(key, buf, contentType);
      return { size: buf.length };
    },
    signedUrl: (key, ttlSec = 3600) => c.presignGet(key, Math.min(ttlSec, 7 * 86400)),
    async read(key, range) {
      const r = await c.get(key, range);
      return { stream: Readable.fromWeb(r.body as never), size: r.size };
    },
    async stat(key) {
      const h = await c.head(key);
      return h ? { size: h.size } : null;
    },
    remove: (key) => c.del(key),
    async createDirectUpload(key, file) {
      if (file.size <= partSize) return { mode: "put", url: await c.presignPut(key, file.size) };
      return { mode: "multipart", uploadId: await c.createMultipart(key, file.contentType), partSize };
    },
    multipart: {
      partSize,
      async sign(key, uploadId, size, parts) {
        const out: Record<number, string> = {};
        for (const n of parts) out[n] = await c.presignPart(key, uploadId, n, partBytes(size, partSize, n));
        return out;
      },
      list: (key, uploadId) => c.listParts(key, uploadId),
      complete: (key, uploadId, parts) => c.completeMultipart(key, uploadId, parts),
      abort: (key, uploadId) => c.abortMultipart(key, uploadId),
    },
  };
}

export const r2Config = (): S3Config => ({
  endpoint: r2Endpoint(env.R2_ACCOUNT_ID, env.R2_ENDPOINT),
  bucket: env.R2_BUCKET,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  region: "auto",
});
export const r2Configured = () => Boolean((env.R2_ACCOUNT_ID || env.R2_ENDPOINT) && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);

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
      return { mode: "tus", token, url, resumableUrl: `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/upload/resumable/sign` };
    },
  };
}

function pick(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case "supabase":
      return supabase();
    case "r2":
      if (!r2Configured()) console.error("[storage] STORAGE_DRIVER=r2 but R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET are not all set");
      return s3Driver(r2Config(), "r2");
    case "s3":
      return s3Driver(
        { endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, region: env.S3_REGION },
        "s3",
      );
    default:
      return local;
  }
}

export const storage: StorageDriver = pick();
