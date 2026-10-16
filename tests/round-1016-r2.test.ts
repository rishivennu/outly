import { afterAll, describe, expect, test } from "bun:test";
import { completeXml, makeS3, parseParts, partBytes, r2Endpoint, xmlTag } from "@/lib/storage/s3x";
import { startFakeS3 } from "./helpers/fake-s3";

const fake = startFakeS3({ accessKeyId: "ak", secret: "sk", bucket: "b" });
afterAll(() => fake.stop());
const s3 = makeS3({ endpoint: fake.url, bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", region: "auto" });

describe("R2 helpers", () => {
  test("endpoint from account id, override wins", () => {
    expect(r2Endpoint(" abc123 ")).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(r2Endpoint("abc", "https://abc.eu.r2.cloudflarestorage.com/")).toBe("https://abc.eu.r2.cloudflarestorage.com");
  });
  test("part sizes: equal parts, last one takes the rest", () => {
    expect(partBytes(25, 10, 1)).toBe(10);
    expect(partBytes(25, 10, 3)).toBe(5);
    expect(partBytes(25, 10, 4)).toBe(0);
    expect(partBytes(20, 10, 2)).toBe(10);
  });
  test("ListParts XML parsing (escaped ETags, pagination)", () => {
    const x = `<ListPartsResult><IsTruncated>true</IsTruncated><NextPartNumberMarker>2</NextPartNumberMarker><Part><PartNumber>1</PartNumber><ETag>&quot;a1&quot;</ETag><Size>5</Size></Part><Part><PartNumber>2</PartNumber><ETag>"b2"</ETag><Size>7</Size></Part></ListPartsResult>`;
    const r = parseParts(x);
    expect(r.parts).toEqual([{ n: 1, etag: '"a1"', size: 5 }, { n: 2, etag: '"b2"', size: 7 }]);
    expect(r.truncated).toBe(true);
    expect(r.next).toBe("2");
    expect(xmlTag("<a>x &amp; y</a>", "a")).toBe("x & y");
  });
  test("CompleteMultipartUpload body is sorted and escaped", () => {
    const x = completeXml([{ n: 2, etag: '"b"' }, { n: 1, etag: '"a"' }]);
    expect(x.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(x.indexOf("<PartNumber>2</PartNumber>"));
    expect(x).toContain("<ETag>&quot;a&quot;</ETag>");
  });
});

describe("R2 driver against a SigV4-verifying fake", () => {
  test("server-side put / head / ranged get (size = whole object) / delete", async () => {
    await s3.put("thumbs/u1/a.jpg", Buffer.from("0123456789"), "image/jpeg");
    expect(await s3.head("thumbs/u1/a.jpg")).toEqual({ size: 10, type: "image/jpeg" });
    const g = await s3.get("thumbs/u1/a.jpg", { start: 2, end: 4 });
    expect(await new Response(g.body).text()).toBe("234");
    expect(g.size).toBe(10);
    await s3.del("thumbs/u1/a.jpg");
    expect(await s3.head("thumbs/u1/a.jpg")).toBeNull();
  });

  test("presigned GET works, a tampered one is refused", async () => {
    await s3.put("videos/u1/v.mp4", Buffer.from("hello"), "video/mp4");
    const u = await s3.presignGet("videos/u1/v.mp4", 600);
    expect(await (await fetch(u)).text()).toBe("hello");
    expect((await fetch(u.replace("videos/u1/v.mp4", "videos/u2/v.mp4"))).status).toBe(403);
  });

  test("presigned PUT is pinned to its Content-Length", async () => {
    const u = await s3.presignPut("videos/u1/small.mp4", 4);
    expect(u).toContain("X-Amz-SignedHeaders=content-length%3Bhost");
    expect((await fetch(u, { method: "PUT", body: "12345678" })).status).toBe(403); // more bytes than declared
    expect((await fetch(u, { method: "PUT", body: "1234" })).status).toBe(200);
    expect((await s3.head("videos/u1/small.mp4"))?.size).toBe(4);
  });

  test("expired URL is refused", async () => {
    const u = await s3.presignPut("videos/u1/x.mp4", 3, 1);
    await Bun.sleep(2100);
    expect((await fetch(u, { method: "PUT", body: "abc" })).status).toBe(403);
  });

  test("full multipart: create, presigned parts (one out of order), list, complete", async () => {
    const key = "videos/u1/big.mp4";
    const size = 25;
    const part = 10;
    const data = Buffer.from("abcdefghijklmnopqrstuvwxy");
    const id = await s3.createMultipart(key, "video/mp4");
    for (const n of [2, 1, 3]) {
      const len = partBytes(size, part, n);
      const u = await s3.presignPart(key, id, n, len);
      const r = await fetch(u, { method: "PUT", body: data.subarray((n - 1) * part, (n - 1) * part + len) });
      expect(r.status).toBe(200);
    }
    const parts = await s3.listParts(key, id);
    expect(parts.map((p) => [p.n, p.size])).toEqual([[1, 10], [2, 10], [3, 5]]);
    await s3.completeMultipart(key, id, parts);
    const g = await s3.get(key);
    expect(Buffer.from(await new Response(g.body).arrayBuffer()).equals(data)).toBe(true);
    // a retried complete sees NoSuchUpload, which the route treats as already done
    await expect(s3.listParts(key, id)).rejects.toMatchObject({ code: "NoSuchUpload" });
  });

  test("a part URL only fits its own part number and size", async () => {
    const key = "videos/u1/p.mp4";
    const id = await s3.createMultipart(key, "video/mp4");
    const u = await s3.presignPart(key, id, 1, 10);
    expect((await fetch(u.replace("partNumber=1", "partNumber=2"), { method: "PUT", body: "0123456789" })).status).toBe(403);
    expect((await fetch(u, { method: "PUT", body: "0123456789AB" })).status).toBe(403);
    await s3.abortMultipart(key, id);
  });

  test("pinLength=false signs host only (escape hatch)", async () => {
    const loose = makeS3({ endpoint: fake.url, bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", region: "auto" }, { pinLength: false });
    const u = await loose.presignPut("videos/u1/loose.mp4", 4);
    expect(u).toContain("X-Amz-SignedHeaders=host");
    expect((await fetch(u, { method: "PUT", body: "1234" })).status).toBe(200);
  });
});
