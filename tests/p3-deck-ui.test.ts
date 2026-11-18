/** Phase 3 B-deck: the deck's wiring (CONTRACT-B props, no own Continue bar, previews, suggestion card, design rules). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const deck = src("components/create/PlatformDeck.tsx");
const prev = src("components/create/Previews.tsx");
const card = src("components/create/SuggestionCard.tsx");
const pane = src("components/create/PlatformPreview.tsx");
const snip = src("components/create/SnippetBar.tsx");
const mine = [deck, prev, card, pane, snip, src("components/create/deck-logic.ts"), src("lib/client/checks.ts")];

describe("p3 deck contract", () => {
  test("props follow CONTRACT-B: no onContinue or docked, proposals/undo/accept/reject/revert required", () => {
    const props = deck.slice(deck.indexOf("interface Props"), deck.indexOf("const READY_LABEL"));
    for (const k of ["onContinue", "docked"]) expect(props).not.toContain(k);
    for (const k of ["proposals: Partial<Record<Platform, Proposal>>;", "undo: Partial<Record<Platform, Undo>>;", "onAccept: (p: Platform) => void;", "onReject: (p: Platform) => void;", "onRevert: (p: Platform) => void;"]) expect(props).toContain(k);
    expect(deck).not.toContain("On to launch");
    expect(deck).not.toMatch(/sticky bottom-/);
  });
  test("the reviewed flag stays per platform and Rewrite goes through onRewrite", () => {
    expect(deck).toContain("p.onDraft(pl, { reviewed: true });");
    expect(deck).toContain("This looks good");
    expect(deck).toContain("onClick={() => p.onRewrite(pl)}");
  });
  test("R1198: platform cards are one compact horizontal switcher, keyboard reachable, names never clipped without a title", () => {
    expect(deck).not.toContain("deck-rail");
    expect(deck).toContain('className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 pb-2');
    expect(deck).toContain("w-[min(80vw,236px)] shrink-0 snap-start");
    expect(deck).toContain("onKeyDown={onCardKeys}");
    expect(deck).toContain('title={who}');
    expect(deck).toContain("onClick={() => p.onConnect(pl)}");
  });
  test("no visibility control (YouTube is sent public by the publisher)", () => {
    expect(deck.toLowerCase()).not.toContain("visibility");
    expect(deck.toLowerCase()).not.toContain("privacy");
  });
  test("two columns from lg, the preview sticks, one column on phones with the preview folded away", () => {
    expect(deck).toContain("lg:grid-cols-[minmax(0,1fr)_clamp(260px,36%,380px)]");
    expect(pane).toContain("lg:sticky");
    expect(pane).toContain("aria-expanded={open}");
  });
  test("suggestions: accept, edit, reject and revert, never applied on their own", () => {
    for (const s of ["Accept", "Edit", "Reject", "Revert", "Why: "]) expect(card).toContain(s);
    expect(deck).toContain("onReject={() => p.onReject(pl)}");
    expect(deck).toContain("onRevert={() => p.onRevert(pl)}");
    expect(deck).toContain("p.onAccept(pl);");
  });
});

describe("p3 previews", () => {
  test("every platform has a preview and the deck player is poster until play, the page's main player", () => {
    expect(prev).toContain("export function PreviewFor");
    expect(prev).toContain("TikTokVideo");
    expect(prev).toContain("FeedPost");
    expect(prev).toContain('usePlayback(ref, "main", src);');
    expect(prev).toContain('usePlayback(ref, "ambient", src);');
    expect(prev).not.toContain("autoPlay");
    expect(prev).toContain("aria-label={`Play ${label}`}");
    expect(pane).toContain("interactive: true");
    // the existing exports the Preview sheet uses stay
    for (const e of ["export function InstagramReel", "export function YouTubeShort", "export function XPost"]) expect(prev).toContain(e);
  });
});

describe("p3 design rules on the deck files", () => {
  test("no transition-all, no em or en dashes, no text under 12px, hover only behind (hover:hover)", () => {
    for (const s of mine) {
      expect(s).not.toContain("transition-all");
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toMatch(/text-\[(1[01]|[0-9])px\]/);
    }
    for (const s of [deck, card, pane, snip]) expect(s).not.toMatch(/(^|\s|")hover:/m);
  });
});
