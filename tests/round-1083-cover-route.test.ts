/**
 * 1083: PUT/DELETE /api/posts/[id]/cover. JPEG only, 2 MB cap, the owner's draft only, never after it went
 * out, and the old file is removed when a new one replaces it.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";

const g = globalThis as unknown as { __coverUser?: unknown };
// bun keeps module mocks for the whole run, so fall back to the real session once this file is done.
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__coverUser !== undefined ? g.__coverUser : realGetCurrentUser()) }));
afterAll(() => { delete g.__coverUser; });

let db: typeof import("../lib/db").db;
let storage: typeof import("../lib/storage").storage;
let route: typeof import("../app/api/posts/[id]/cover/route");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800, 2)]);

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ storage } = await import("../lib/storage"));
  route = await import("../app/api/posts/[id]/cover/route");
}, 60_000);

let n = 0;
async function setup(status = "draft") {
  n++;
  const user = await db.user.create({ data: { name: "CR", email: `cr${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `cr/${n}.mp4`, mimeType: "video/mp4", size: 1000, status: "ready" } });
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status } });
  await db.postTarget.create({ data: { postId: post.id, platform: "youtube", coverError: "old reason" } });
  g.__coverUser = { ...user, role: "owner", joinedAt: user.createdAt };
  return { user, post };
}
const req = (method: string, id: string, body?: Buffer, type = "image/jpeg") =>
  new NextRequest(`http://localhost/api/posts/${id}/cover`, { method, body: body ? new Uint8Array(body) : undefined, headers: { origin: "http://localhost", host: "localhost", "content-type": type } });
const put = (id: string, body: Buffer, type?: string) => route.PUT(req("PUT", id, body, type), { params: { id } });

describe("cover upload route", () => {
  test("stores a JPEG on the post, clears old cover state, replaces and removes the old file", async () => {
    const { post } = await setup();
    const r1 = await put(post.id, JPEG);
    expect(r1.status).toBe(200);
    expect((await r1.json()).coverUrl).toBeTruthy();
    const first = (await db.post.findUniqueOrThrow({ where: { id: post.id } })).coverKey!;
    expect(first).toStartWith("covers/");
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: post.id } })).coverError).toBeNull();
    await put(post.id, JPEG);
    const second = (await db.post.findUniqueOrThrow({ where: { id: post.id } })).coverKey!;
    expect(second).not.toBe(first);
    expect(await storage.stat!(first)).toBeNull();
    const del = await route.DELETE(req("DELETE", post.id), { params: { id: post.id } });
    expect(del.status).toBe(200);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).coverKey).toBeNull();
  });
  test("refuses anything that isn't a JPEG, or is over 2 MB", async () => {
    const { post } = await setup();
    expect((await put(post.id, JPEG, "image/png")).status).toBe(415);
    expect((await put(post.id, Buffer.from("not an image at all"))).status).toBe(415);
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await put(post.id, big)).status).toBe(413);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).coverKey).toBeNull();
  });
  test("can't change after it went out, and nobody else's post", async () => {
    const live = await setup("published");
    expect((await put(live.post.id, JPEG)).status).toBe(409);
    const other = await setup();
    await setup(); // signed in as someone else now
    expect((await put(other.post.id, JPEG)).status).toBe(404);
  });
});
