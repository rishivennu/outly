/**
 * 1162: on Everywhere, a platform with more than one connected account lets the creator pick which one the post goes
 * to (kept on the draft as accountId, sent to the server only when it is a real choice). And "Start over" from any
 * step keeps what is here as a draft and opens a clean Create.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pickedAccount, targetPayload } from "../components/create/publish";
import { emptyDraft } from "../components/create/types";
import { PLATFORMS, type Platform } from "../lib/domain";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const drafts = () => Object.fromEntries(PLATFORMS.map((p) => [p, emptyDraft(false)])) as Record<Platform, ReturnType<typeof emptyDraft>>;
const A = { id: "a1", platform: "instagram", status: "connected" };
const B = { id: "b2", platform: "instagram", status: "connected" };
const OLD = { id: "o3", platform: "instagram", status: "expired" };
const Y = { id: "y4", platform: "youtube", status: "connected" };

describe("1162 which account", () => {
  test("a pick counts only among several accounts on that platform, and only a connected one", () => {
    expect(pickedAccount("instagram", "b2", [A, B, Y])).toEqual(B);
    expect(pickedAccount("instagram", "b2", [B, Y])).toBeNull(); // one account: nothing to choose, the server's default stands
    expect(pickedAccount("instagram", "o3", [A, OLD])).toBeNull(); // expired: never named, so a save can't 403
    expect(pickedAccount("instagram", "zz", [A, B])).toBeNull(); // gone (disconnected or unshared): falls back
    expect(pickedAccount("youtube", "b2", [A, B, Y])).toBeNull(); // another platform's id never crosses over
    expect(pickedAccount("instagram", null, [A, B])).toBeNull();
  });
  test("the targets payload names the account only when it is a real pick", () => {
    const d = drafts();
    d.instagram = { ...d.instagram, enabled: true, caption: "hi", accountId: "b2" };
    d.youtube = { ...d.youtube, enabled: true, title: "t", accountId: "y4" };
    const out = targetPayload(d, [A, B, Y]);
    expect(out.find((t) => t.platform === "instagram")).toMatchObject({ accountId: "b2" });
    expect("accountId" in out.find((t) => t.platform === "youtube")!).toBe(false); // the only YouTube account
    // without choices (older callers) the payload is exactly what it was
    for (const t of targetPayload(d)) expect("accountId" in t).toBe(false);
  });
  test("the pick travels with the draft, on the device too", () => {
    expect(src("lib/client/checks.ts")).toMatch(/accountId\?: string \| null;/);
    expect(src("lib/client/device-drafts.ts")).toMatch(/interface DeviceTarget \{[\s\S]*?accountId\?: string \| null;/);
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain("firstComment: x.firstComment, accountId: x.accountId ?? null }");
    expect(ws).toContain("targets: targetPayload(drafts, choices)");
    expect(ws).not.toContain("targetPayload(drafts)");
  });
  test("the page hands every account this person may post to down to the workspace", () => {
    const page = src("app/(studio)/create/page.tsx");
    expect(page).toContain("composerChoices(user)");
    expect(page).toContain("choices={choices.map(accountView)}");
    const prof = src("lib/profiles.ts");
    expect(prof).toMatch(/export async function composerChoices[\s\S]*?filter\(\(a\) => inScope\(user\.scope, a\.id\)\)/);
  });
  test("the workspace shows the picked account everywhere the account shows, and only offers a choice where there is one", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain("const a = pickedAccount(p, drafts[p].accountId, choices);");
    expect(ws).toContain('if (a.status !== "connected") continue;');
    expect(ws).toContain("if ((out[p]?.length ?? 0) < 2) delete out[p];");
    expect(ws).toContain("options={options}");
    // R1209: the platform switches live on the deck now, which gets the accounts on its own line.
    expect(ws).toMatch(/<PlatformDeck[^>]*?\n\s*accounts=\{accounts\}/);
    for (const s of ["<LaunchPanel", "<PreviewSheet"]) expect(ws).toMatch(new RegExp(`${s}[^\\n]*accounts=\\{accounts\\}`));
  });
  test("the deck: a labelled native select on the card, only when connected with several, writing the pick to the draft", () => {
    const deck = src("components/create/PlatformDeck.tsx");
    expect(deck).toContain("const choice = connected && acct ? p.options?.[pl] : undefined;");
    expect(deck).toContain("aria-label={`Which ${PLATFORM_META[pl].name} account`}");
    expect(deck).toContain("onChange={(e) => p.onDraft(pl, { accountId: e.target.value })}");
    expect(deck).toMatch(/<select[\s\S]*?className=\{cn\("h-9 /); // inside an h-11 row: a 44px target
    expect(deck).toContain('{fmtHandle(a.username)}{a.mock ? " (practice)" : ""}');
  });
});

describe("1162 start over", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  test("keeps the draft first (device, then Outlly), waits for an upload in flight, then opens a clean Create", () => {
    const fn = ws.slice(ws.indexOf("const startOver = async () => {"), ws.indexOf("const startOverButton"));
    expect(fn.indexOf("await mediaReady.current")).toBeLessThan(fn.indexOf("writeLocal.current();"));
    expect(fn.indexOf("writeLocal.current();")).toBeLessThan(fn.indexOf("await sync.syncNow();"));
    expect(fn.indexOf("await sync.syncNow();")).toBeLessThan(fn.indexOf("another();"));
    // a failed sync never traps the creator here; R1209: the fresh page says what happened to the work
    expect(fn).toMatch(/catch \{[\s\S]*?\}\s*flashNext\([\s\S]*?\);\s*another\(\);/);
  });
  test("asks first when there is something to keep; with no video it just starts", () => {
    expect(ws).toContain("onClick={() => (hasMedia ? (setOverError(null), setOverAsk(true)) : another())}");
    // R1209 B: save, delete (after a second confirmation) or cancel, in StartOverDialog
    expect(ws).toContain("<StartOverDialog\n          open={overAsk}");
    expect(ws).toContain("onSave={() => void startOver()}");
    expect(ws).toContain("onDelete={() => void deleteAndStartOver()}");
    expect(ws).toContain("disabled={!!overBusy || phase !== \"edit\"}"); // never while the post is going out
  });
  test("on the rail from 1280px, and in the top row below it, on every step", () => {
    expect(ws).toMatch(/const railStatus = \([\s\S]*?\{startOverButton\}/);
    expect(ws).toMatch(/const pipButton = \([\s\S]*?\{startOverButton\}/);
    expect(ws).toContain('<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Start over');
  });
});
