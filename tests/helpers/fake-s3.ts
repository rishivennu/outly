import { createHash, createHmac } from "node:crypto";

/**
 * Minimal S3/R2 stand-in for tests: path-style bucket, objects + multipart in memory, CORS, and an
 * INDEPENDENT SigV4 verifier (written from the AWS spec, not from aws4fetch), so a bad signature,
 * a wrong Content-Length on a pinned URL or an expired URL is rejected like the real thing.
 */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s).digest();

export function startFakeS3(opts: { port?: number; accessKeyId: string; secret: string; bucket: string }) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const log: string[] = [];
  let seq = 0;

  function verify(req: Request, url: URL): string | null {
    const q = url.searchParams;
    const auth = req.headers.get("authorization");
    let cred: string, signedHeaders: string, sig: string, amzDate: string, payload: string;
    if (q.has("X-Amz-Signature")) {
      cred = q.get("X-Amz-Credential")!;
      signedHeaders = q.get("X-Amz-SignedHeaders")!;
      sig = q.get("X-Amz-Signature")!;
      amzDate = q.get("X-Amz-Date")!;
      payload = "UNSIGNED-PAYLOAD";
      const t = Date.UTC(+amzDate.slice(0, 4), +amzDate.slice(4, 6) - 1, +amzDate.slice(6, 8), +amzDate.slice(9, 11), +amzDate.slice(11, 13), +amzDate.slice(13, 15));
      if (Date.now() > t + Number(q.get("X-Amz-Expires")) * 1000) return "ExpiredRequest";
    } else if (auth) {
      const m = /Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(auth);
      if (!m) return "AccessDenied";
      [, cred, signedHeaders, sig] = m;
      amzDate = req.headers.get("x-amz-date") ?? "";
      payload = req.headers.get("x-amz-content-sha256") ?? "";
    } else return "AccessDenied";
    const [ak, date, region, service] = cred.split("/");
    if (ak !== opts.accessKeyId) return "InvalidAccessKeyId";
    const query = [...q.entries()]
      .filter(([k]) => k !== "X-Amz-Signature")
      .map(([k, v]) => [enc(k), enc(v)])
      .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const names = signedHeaders.split(";");
    const headers = names.map((h) => `${h}:${(h === "host" ? url.host : req.headers.get(h) ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
    const canonical = [req.method, url.pathname, query, headers, signedHeaders, payload].join("\n");
    const scope = `${date}/${region}/${service}/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canonical)].join("\n");
    const key = hmac(hmac(hmac(hmac("AWS4" + opts.secret, date), region), service), "aws4_request");
    return hmac(key, toSign).toString("hex") === sig ? null : "SignatureDoesNotMatch";
  }

  const xml = (s: string, status = 200) => new Response(`<?xml version="1.0" encoding="UTF-8"?>${s}`, { status, headers: { "content-type": "application/xml" } });
  const err = (code: string, status: number) => xml(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`, status);
  const cors = (r: Response) => {
    r.headers.set("access-control-allow-origin", "*");
    r.headers.set("access-control-expose-headers", "ETag");
    return r;
  };

  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS")
        return cors(new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,PUT,HEAD,POST,DELETE", "access-control-allow-headers": "*", "access-control-max-age": "600" } }));
      const bad = verify(req, url);
      log.push(`${req.method} ${url.pathname}${url.search ? "?" + [...url.searchParams.keys()].filter((k) => !k.startsWith("X-Amz")).join("&") : ""} ${bad ?? "ok"}`);
      if (bad) return cors(err(bad, 403));
      const [, bucket, ...rest] = url.pathname.split("/");
      if (bucket !== opts.bucket) return cors(err("NoSuchBucket", 404));
      const key = rest.map(decodeURIComponent).join("/");
      const q = url.searchParams;
      const uploadId = q.get("uploadId");
      if (req.method === "POST" && q.has("uploads")) {
        const id = `up-${++seq}`;
        uploads.set(id, { key, parts: new Map() });
        return cors(xml(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`));
      }
      if (uploadId) {
        const up = uploads.get(uploadId);
        if (!up || up.key !== key) return cors(err("NoSuchUpload", 404));
        if (req.method === "PUT") {
          const body = Buffer.from(await req.arrayBuffer());
          up.parts.set(Number(q.get("partNumber")), body);
          return cors(new Response(null, { headers: { etag: `"${sha(body).slice(0, 32)}"` } }));
        }
        if (req.method === "GET") {
          const parts = [...up.parts.entries()].sort(([a], [b]) => a - b);
          const marker = Number(q.get("part-number-marker") ?? 0);
          const max = Number(q.get("max-parts") ?? 1000);
          const page = parts.filter(([n]) => n > marker).slice(0, max);
          const truncated = parts.filter(([n]) => n > marker).length > max;
          return cors(
            xml(
              `<ListPartsResult><UploadId>${uploadId}</UploadId><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextPartNumberMarker>${page.at(-1)![0]}</NextPartNumberMarker>` : ""}` +
                page.map(([n, b]) => `<Part><PartNumber>${n}</PartNumber><ETag>&quot;${sha(b).slice(0, 32)}&quot;</ETag><Size>${b.length}</Size></Part>`).join("") +
                `</ListPartsResult>`,
            ),
          );
        }
        if (req.method === "POST") {
          const body = await req.text();
          const want = [...body.matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag>/g)].map((m) => ({ n: +m[1], etag: m[2].replace(/&quot;/g, '"') }));
          const bufs: Buffer[] = [];
          for (const w of want) {
            const b = up.parts.get(w.n);
            if (!b || `"${sha(b).slice(0, 32)}"` !== w.etag) return cors(err("InvalidPart", 400));
            bufs.push(b);
          }
          objects.set(key, { body: Buffer.concat(bufs), type: "video/mp4" });
          uploads.delete(uploadId);
          return cors(xml(`<CompleteMultipartUploadResult><Key>${key}</Key></CompleteMultipartUploadResult>`));
        }
        if (req.method === "DELETE") {
          uploads.delete(uploadId);
          return cors(new Response(null, { status: 204 }));
        }
      }
      if (req.method === "PUT") {
        objects.set(key, { body: Buffer.from(await req.arrayBuffer()), type: req.headers.get("content-type") ?? "" });
        return cors(new Response(null, { headers: { etag: '"x"' } }));
      }
      const o = objects.get(key);
      if (req.method === "DELETE") {
        objects.delete(key);
        return cors(new Response(null, { status: 204 }));
      }
      if (!o) return cors(req.method === "HEAD" ? new Response(null, { status: 404 }) : err("NoSuchKey", 404));
      if (req.method === "HEAD") return cors(new Response(null, { headers: { "content-length": String(o.body.length), "content-type": o.type } }));
      const range = /bytes=(\d+)-(\d+)/.exec(req.headers.get("range") ?? "");
      if (range) {
        const a = +range[1];
        const b = Math.min(+range[2], o.body.length - 1);
        return cors(new Response(o.body.subarray(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${o.body.length}`, "content-type": o.type } }));
      }
      return cors(new Response(o.body, { headers: { "content-type": o.type } }));
    },
  });
  return { url: `http://localhost:${server.port}`, objects, uploads, log, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const s = startFakeS3({ port: Number(process.env.FAKE_S3_PORT ?? 9555), accessKeyId: "test-ak", secret: "test-secret", bucket: "outlly-media" });
  console.log("fake s3 on", s.url);
  setInterval(() => {
    if (s.log.length) console.log(s.log.splice(0).join("\n"));
  }, 1000);
}
