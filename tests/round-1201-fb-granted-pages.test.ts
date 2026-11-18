/**
 * R1201: Facebook Login for Business can grant a Page through business access. /me/accounts then comes back empty
 * even though the token holds every Page permission for it, and connect failed with "doesn't manage a Page yet".
 * The fallback reads the granted Page ids from the token's granular scopes and fetches each Page directly.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(routes: (url: URL) => unknown): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = String(input instanceof Request ? input.url : input);
    calls.push(raw);
    const body = routes(new URL(raw));
    if (body === undefined) return new Response('{"error":{"message":"nope"}}', { status: 400 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const page = (id: string, name: string) => ({ id, name, access_token: `tok-${id}`, picture: { data: { url: `https://x/${id}.png` } } });
const tokens = (u: URL): unknown =>
  u.pathname.endsWith("/oauth/access_token") ? { access_token: u.searchParams.get("grant_type") ? "long-user" : "short-user" } : u.pathname.endsWith("/me") ? { id: "asid-1" } : undefined;

let FacebookPublisher: typeof import("../lib/social/facebook").FacebookPublisher;
let grantedPages: typeof import("../lib/social/facebook").grantedPages;
beforeAll(async () => {
  const keys = await import("../lib/social/keys");
  keys.__setKeys({ facebook: { clientId: "app1", clientSecret: "sec" } } as never);
  ({ FacebookPublisher, grantedPages } = await import("../lib/social/facebook"));
});

describe("R1201 Facebook Pages granted through business access", () => {
  test("empty /me/accounts falls back to the token's granted Pages and connects TheFinds with its own token", async () => {
    const calls = stub((u) => {
      if (u.pathname.endsWith("/me/accounts")) return { data: [] };
      if (u.pathname.endsWith("/debug_token"))
        return { data: { granular_scopes: [{ scope: "pages_show_list", target_ids: ["152856847912438"] }, { scope: "pages_manage_posts", target_ids: ["152856847912438"] }] } };
      if (u.pathname.endsWith("/152856847912438")) return page("152856847912438", "TheFinds");
      return tokens(u);
    });
    const p = await new FacebookPublisher().completeConnect("code-1", "https://www.outlly.com/api/accounts/facebook/callback");
    expect(p.platformUserId).toBe("152856847912438");
    expect(p.username).toBe("TheFinds");
    expect(p.accessToken).toBe("tok-152856847912438");
    expect(p.avatar).toBe("https://x/152856847912438.png");
    expect(p.metadata).toEqual({ pages: [{ id: "152856847912438", name: "TheFinds" }], metaUserId: "asid-1" });
    const dbg = new URL(calls.find((c) => c.includes("/debug_token"))!);
    expect(dbg.searchParams.get("input_token")).toBe("long-user");
    expect(dbg.searchParams.get("access_token")).toBe("app1|sec");
    const pg = new URL(calls.find((c) => c.includes("/152856847912438?"))!);
    expect(pg.searchParams.get("access_token")).toBe("long-user");
  });

  test("a non-empty /me/accounts is used as before, with no debug_token call", async () => {
    const calls = stub((u) => (u.pathname.endsWith("/me/accounts") ? { data: [page("1", "Mine"), page("2", "Other")] } : tokens(u)));
    const p = await new FacebookPublisher().completeConnect("code-2", "https://r");
    expect(p.platformUserId).toBe("1");
    expect(calls.some((c) => c.includes("/debug_token"))).toBe(false);
    expect((p as { alternatives?: { platformUserId: string }[] }).alternatives?.map((a) => a.platformUserId)).toEqual(["2"]);
  });

  test("no Page anywhere still says so (NO_PAGE)", async () => {
    stub((u) => (u.pathname.endsWith("/me/accounts") ? { data: [] } : u.pathname.endsWith("/debug_token") ? { data: { granular_scopes: [{ scope: "pages_show_list" }] } } : tokens(u)));
    const err = await new FacebookPublisher().completeConnect("code-3", "https://r").catch((e: Error & { code?: string }) => e);
    expect((err as { code?: string }).code).toBe("NO_PAGE");
  });

  test("Pages you can post to come first, ids are deduped, and a Page that fails to load is dropped", async () => {
    stub((u) => {
      if (u.pathname.endsWith("/debug_token"))
        return { data: { granular_scopes: [{ scope: "pages_show_list", target_ids: ["9", "7", "8"] }, { scope: "pages_manage_posts", target_ids: ["7"] }, { scope: "pages_messaging", target_ids: ["5"] }] } };
      if (u.pathname.endsWith("/7")) return page("7", "Seven");
      if (u.pathname.endsWith("/9")) return page("9", "Nine");
      if (u.pathname.endsWith("/8")) return { id: "8", name: "No token" };
      return undefined;
    });
    expect((await grantedPages("u", "a", "s")).map((p) => p.id)).toEqual(["7", "9"]);
  });

  test("a failed debug_token gives no Pages rather than throwing", async () => {
    stub(() => undefined);
    expect(await grantedPages("u", "a", "s")).toEqual([]);
  });
});
