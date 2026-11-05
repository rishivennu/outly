/** 1136: comment and message pushes, reply actions, deep links, and the service worker that draws them. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { actionsOf, payloadOf } from "../lib/push/webpush";
import { MAX_PLAINTEXT } from "../lib/push/webpush-core";
import { pickParams, stripParams } from "../lib/client/deep-link";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const base = { title: "New comment", body: "Someone replied", tag: "t", kind: "new_comment" as const };

describe("1136 push actions on the wire", () => {
  test("a button survives as {action,title,href}", () => {
    const p = JSON.parse(payloadOf({ ...base, actions: [{ action: "open", title: "Open post", href: "/create?post=1" }] }));
    expect(p.a).toEqual([{ action: "open", title: "Open post", href: "/create?post=1" }]);
  });

  test("keepOpen becomes q:1, and is absent otherwise", () => {
    expect(JSON.parse(payloadOf({ ...base, keepOpen: true })).q).toBe(1);
    expect(JSON.parse(payloadOf(base)).q).toBeUndefined();
  });

  test("at most two buttons, titles trimmed, off-site links refused", () => {
    const out = actionsOf([
      { action: "a", title: "  A very long button title that no browser will ever draw  ", href: "https://evil.example/x" },
      { action: "b", title: "Fix it", href: "/create?post=1" },
      { action: "c", title: "Third", href: "/home" },
    ])!;
    expect(out.length).toBe(2);
    expect(out[0].title.length).toBeLessThanOrEqual(24);
    expect(out[0].href).toBe("/home");
    expect(out[1].href).toBe("/create?post=1");
  });

  test("a bad action id or an empty title is dropped, and nothing left means no key at all", () => {
    expect(actionsOf([{ action: "no spaces", title: "x", href: "/home" }])).toBeUndefined();
    expect(actionsOf([{ action: "ok", title: "   ", href: "/home" }])).toBeUndefined();
    expect(JSON.parse(payloadOf({ ...base, actions: [] })).a).toBeUndefined();
  });

  test("an oversized push drops the buttons before it drops the body, and always fits", () => {
    const m = { ...base, body: "x".repeat(4000), icon: "/brand/platforms/instagram-192.png", actions: [{ action: "open", title: "Open", href: "/home" }] };
    const p = payloadOf(m);
    expect(p.length).toBeLessThanOrEqual(MAX_PLAINTEXT);
    const o = JSON.parse(p);
    expect(o.t).toBe(base.title);
    expect(o.b.length).toBeGreaterThan(0);
  });

  test("the reply target keeps its short keys, and a strange id is refused", () => {
    expect(JSON.parse(payloadOf({ ...base, reply: { kind: "comment", targetId: "a:1:2", commentId: "c1" } })).r).toEqual({ k: "cm", t: "a:1:2", c: "c1" });
    expect(JSON.parse(payloadOf({ ...base, reply: { kind: "dm", threadId: "bad id with spaces" } })).r).toBeUndefined();
  });
});

describe("1136 service worker", () => {
  const sw = src("public/sw.js");

  test("q:1 asks the system to keep the notification up", () => {
    expect(sw).toContain("d.q === 1");
    expect(sw).toContain("requireInteraction = true");
  });

  test("buttons are built from d.a and never more than two", () => {
    expect(sw).toMatch(/function buttons/);
    expect(sw).toMatch(/slice\(0, 2\)/);
  });

  test("a button click opens its own link, and only a path on our own origin", () => {
    expect(sw).toContain("d.links && d.links[e.action]");
    expect(sw).toContain("const safePath = (h) =>");
    expect(sw).toContain('/^\\/(?![/\\\\])/.test(h) ? h : "/home"');
    expect(sw).toContain('out[`go:${a.action}`] = safePath(a.href)');
  });

  test("a reply is posted to our own route and only claims to be sent when the server says so", () => {
    expect(sw).toContain('"/api/push/reply"');
    expect(sw).toContain('showNotification("Reply sent"');
    expect(sw).toContain("res.ok");
  });

  test("no emoji in anything the worker shows", () => {
    expect(sw).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe("1136 deep links", () => {
  test("picks only the keys asked for", () => {
    expect(pickParams("?thread=t1&other=x", ["thread"])).toEqual({ thread: "t1" });
    expect(pickParams("?comment=c1&target=a:1:2", ["comment", "target"])).toEqual({ comment: "c1", target: "a:1:2" });
    expect(pickParams("?other=x", ["thread"])).toBeNull(); // half a link opens nothing
    expect(pickParams("?comment=c1", ["comment", "target"])).toBeNull();
  });

  test("strips them from the address without losing the rest", () => {
    expect(stripParams("/inbox?comment=c1&tab=comments", ["comment"])).toBe("/inbox?tab=comments");
    expect(stripParams("/inbox?comment=c1", ["comment"])).toBe("/inbox");
    expect(stripParams("https://www.outlly.com/inbox?comment=c1&tab=x", ["comment"])).toBe("https://www.outlly.com/inbox?tab=x");
    expect(stripParams("/inbox", ["comment"])).toBeNull(); // nothing to tidy, so the address bar is left alone
  });
});

describe("1136 platform icons", () => {
  for (const p of ["instagram", "youtube", "x", "tiktok", "threads", "facebook", "linkedin"])
    test(`${p} has a 192px tile for the notification`, () => {
      const buf = readFileSync(join(import.meta.dir, "..", "public", "brand", "platforms", `${p}-192.png`));
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.readUInt32BE(16)).toBe(192); // PNG IHDR width
      expect(buf.readUInt32BE(20)).toBe(192);
    });
});
