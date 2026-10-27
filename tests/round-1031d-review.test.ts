// 1031d: fixes from the independent review of the DM bundle.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8");

describe("Instagram: messages permission left unticked", () => {
  test("missingScopes names the messages permission only when it is absent", async () => {
    const { missingScopes } = await import("../lib/social/instagram");
    expect(missingScopes(undefined)).toEqual([]);
    expect(missingScopes("instagram_business_basic,instagram_business_manage_messages")).toEqual([]);
    expect(missingScopes(["instagram_business_basic", "instagram_business_manage_messages"])).toEqual([]);
    expect(missingScopes("instagram_business_basic, instagram_business_content_publish")).toEqual(["instagram_business_manage_messages"]);
  });
  test("callback tells the creator, Accounts shows it", () => {
    expect(src("app/api/accounts/[platform]/callback/route.ts")).toContain('prof.declined?.length ? "&notice=dm_scope"');
    expect(src("components/settings/AccountsView.tsx")).toContain('params.get("notice") === "dm_scope"');
  });
});

describe("webhook stays inside Meta's timeout", () => {
  test("events are capped and profile lookups are bounded", () => {
    const r = src("app/api/webhooks/meta/route.ts");
    expect(r).toContain("parseWebhook(body).slice(0, MAX_EVENTS)");
    expect(r).toContain("profileLookups: 5");
    const s = src("lib/messages/service.ts");
    expect(s).toContain("if (lookup && !isPracticeAccount(acct)");
    expect(s).toContain("fill.participantName = hint.participantName");
  });
});

describe("sync is rate limited apart from the list", () => {
  test("?sync=1 has its own tighter limiter", () => {
    const r = src("app/api/messages/route.ts");
    expect(r).toContain("limitShared(`dm-sync:${user.id}`, 6, 60_000)");
    expect(r).toContain("syncSkipped");
  });
});

describe("Messages UI", () => {
  test("editors get a read-only note instead of the composer", () => {
    expect(src("app/(studio)/inbox/page.tsx")).toContain('readOnly: user.role === "editor"');
    const v = src("components/inbox/MessagesView.tsx");
    expect(v).toContain("{readOnly ? (");
    expect(v).toContain("Editors can read messages.");
  });
  test("attachment links must be https", () => {
    expect(src("components/inbox/MessagesView.tsx")).toContain("/^https:\\/\\//i.test(a.url)");
  });
});
