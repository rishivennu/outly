import { AwsClient, AwsV4Signer } from "aws4fetch";

/**
 * S3-compatible object storage (Cloudflare R2, AWS S3, MinIO) over plain fetch + SigV4.
 * Kept free of "server-only" and env so it can be unit tested with a mocked fetch.
 *
 * Big browser uploads use S3 multipart with presigned part URLs: the server signs, the browser
 * PUTs each part straight to the bucket, the server completes. Every presigned PUT has its exact
 * Content-Length signed in, so a URL can only ever carry the bytes the server expected.
 */
export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface PartInfo {
  n: number;
  etag: string;
  size: number;
}

export const r2Endpoint = (accountId: string, override = "") =>
  (override || `https://${accountId.trim()}.r2.cloudflarestorage.com`).replace(/\/$/, "");

export const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export const xmlUnesc = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#34;/g, '"').replace(/&amp;/g, "&");

/** First <name>value</name> in an XML string, unescaped. */
export function xmlTag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? xmlUnesc(m[1]) : null;
}

export function parseParts(xml: string): { parts: PartInfo[]; truncated: boolean; next: string | null } {
  const parts: PartInfo[] = [];
  for (const m of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
    const n = Number(xmlTag(m[1], "PartNumber"));
    const etag = xmlTag(m[1], "ETag") ?? "";
    const size = Number(xmlTag(m[1], "Size") ?? 0);
    if (n > 0 && etag) parts.push({ n, etag, size });
  }
  return { parts, truncated: xmlTag(xml, "IsTruncated") === "true", next: xmlTag(xml, "NextPartNumberMarker") };
}

export function completeXml(parts: { n: number; etag: string }[]) {
  const body = [...parts]
    .sort((a, b) => a.n - b.n)
    .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${xmlEsc(p.etag)}</ETag></Part>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</CompleteMultipartUpload>`;
}

/** Byte size of part n (1-based) of a file split into equal parts, the last one taking the rest. */
export function partBytes(size: number, partSize: number, n: number) {
  const total = Math.max(1, Math.ceil(size / partSize));
  if (n < 1 || n > total) return 0;
  return n < total ? partSize : size - partSize * (total - 1);
}

export class S3Error extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function fail(r: Response, what: string): Promise<never> {
  const text = await r.text().catch(() => "");
  throw new S3Error(r.status, xmlTag(text, "Code") ?? "", `${what} failed: ${r.status} ${xmlTag(text, "Message") ?? ""}`.trim());
}

export function makeS3(cfg: S3Config, opts: { pinLength?: boolean } = {}) {
  const pin = opts.pinLength !== false;
  const aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region || "auto", service: "s3", retries: 2 });
  const base = cfg.endpoint.replace(/\/$/, "");
  const url = (key: string, q = "") => `${base}/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}${q ? `?${q}` : ""}`;

  const presign = async (method: "GET" | "PUT", target: string, ttlSec: number, contentLength?: number) => {
    const u = new URL(target);
    u.searchParams.set("X-Amz-Expires", String(ttlSec));
    const headers = new Headers();
    const pinned = pin && contentLength !== undefined;
    if (pinned) headers.set("content-length", String(contentLength));
    const signed = await new AwsV4Signer({
      url: u.toString(),
      method,
      headers,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region || "auto",
      service: "s3",
      signQuery: true,
      allHeaders: pinned, // content-length is "unsignable" by default; we want it pinned
    }).sign();
    return signed.url.toString();
  };

  return {
    url,
    async put(key: string, body: Buffer, contentType: string) {
      const r = await aws.fetch(url(key), { method: "PUT", body, headers: { "content-type": contentType } });
      if (!r.ok) await fail(r, "put");
    },
    presignGet: (key: string, ttlSec: number) => presign("GET", url(key), ttlSec),
    /** One-shot browser PUT for a whole small file, pinned to exactly `size` bytes. */
    presignPut: (key: string, size: number, ttlSec = 3600) => presign("PUT", url(key), ttlSec, size),
    presignPart: (key: string, uploadId: string, n: number, size: number, ttlSec = 3600) =>
      presign("PUT", url(key, `partNumber=${n}&uploadId=${encodeURIComponent(uploadId)}`), ttlSec, size),
    async head(key: string) {
      const r = await aws.fetch(url(key), { method: "HEAD" });
      if (r.status === 404) return null;
      if (!r.ok) await fail(r, "head");
      return { size: Number(r.headers.get("content-length") ?? 0), type: r.headers.get("content-type") ?? "" };
    },
    async get(key: string, range?: { start: number; end: number }) {
      const headers: Record<string, string> = {};
      if (range) headers.range = `bytes=${range.start}-${range.end}`;
      const r = await aws.fetch(url(key), { headers });
      if (!r.ok || !r.body) await fail(r, "get");
      // A ranged read reports the WHOLE object size, like the other drivers (Content-Range: bytes a-b/total).
      const total = Number(r.headers.get("content-range")?.split("/")[1] ?? r.headers.get("content-length") ?? 0);
      return { body: r.body!, size: total };
    },
    async del(key: string) {
      const r = await aws.fetch(url(key), { method: "DELETE" });
      if (!r.ok && r.status !== 404) await fail(r, "delete");
    },
    async createMultipart(key: string, contentType: string) {
      const r = await aws.fetch(url(key, "uploads="), { method: "POST", headers: { "content-type": contentType } });
      if (!r.ok) await fail(r, "create multipart");
      const id = xmlTag(await r.text(), "UploadId");
      if (!id) throw new S3Error(502, "NoUploadId", "create multipart returned no UploadId");
      return id;
    },
    async listParts(key: string, uploadId: string) {
      const all: PartInfo[] = [];
      let marker: string | null = null;
      for (let page = 0; page < 20; page++) {
        const q = `uploadId=${encodeURIComponent(uploadId)}&max-parts=1000${marker ? `&part-number-marker=${encodeURIComponent(marker)}` : ""}`;
        const r = await aws.fetch(url(key, q));
        if (!r.ok) await fail(r, "list parts");
        const { parts, truncated, next } = parseParts(await r.text());
        all.push(...parts);
        if (!truncated || !next) break;
        marker = next;
      }
      return all.sort((a, b) => a.n - b.n);
    },
    async completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]) {
      const r = await aws.fetch(url(key, `uploadId=${encodeURIComponent(uploadId)}`), {
        method: "POST",
        body: completeXml(parts),
        headers: { "content-type": "application/xml" },
      });
      // S3 can answer 200 and still put an <Error> in the body.
      const text = r.ok ? await r.text() : "";
      if (!r.ok) await fail(r, "complete multipart");
      if (/<Error>/.test(text)) throw new S3Error(500, xmlTag(text, "Code") ?? "", `complete multipart failed: ${xmlTag(text, "Message") ?? ""}`);
    },
    async abortMultipart(key: string, uploadId: string) {
      const r = await aws.fetch(url(key, `uploadId=${encodeURIComponent(uploadId)}`), { method: "DELETE" });
      if (!r.ok && r.status !== 404) await fail(r, "abort multipart");
    },
  };
}
export type S3 = ReturnType<typeof makeS3>;
