/**
 * 1190 "Write once. Outlly adapts it everywhere." Step 2 is now one box: the creator writes their message once
 * and Pip writes every place's caption from it, without adding a fact, a number, a promise or a hashtag they
 * did not give. These tests hold the faithful half: what is pulled out of the box, what counts as a long video,
 * when Pip asks instead of guessing, which YouTube chapters survive, and the no-AI path that never invents.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADAPT_MAX, ADAPT_TONES, CTA_PREFIX, cleanChapters, clarifyFor, copyKey, firstSentence, isLongForm, KEYWORDS_PREFIX, LONG_FORM_SEC, longFormRules, offlineAdapt, splitStory, stamp, tagsFrom, timedTranscript, toneLine, withLine } from "../lib/ai/adapt-core";
import { DEFAULT_RULES } from "../lib/ai/caption-engine";
import { composedCopy } from "../lib/client/checks";
import { PLATFORM_META } from "../lib/domain";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("1190 the message, pulled apart", () => {
  test("CTA and Keywords lines leave the body; keywords split and de-duplicate", () => {
    const r = splitStory("I tried the 5am routine for 30 days.\nCTA: follow for week two\nKeywords: 5am routine, discipline, 5AM Routine");
    expect(r.body).toBe("I tried the 5am routine for 30 days.");
    expect(r.cta).toBe("follow for week two");
    expect(r.keywords).toEqual(["5am routine", "discipline"]);
  });

  test("no labelled lines: the whole text is the message", () => {
    const r = splitStory("  Just my bakery's busiest morning.  ");
    expect(r.body).toBe("Just my bakery's busiest morning.");
    expect(r.cta).toBe("");
    expect(r.keywords).toEqual([]);
  });

  test("the chips add a labelled line once, then put the cursor on the one already there", () => {
    const first = withLine("My video", CTA_PREFIX);
    expect(first.text).toBe("My video\nCTA: ");
    expect(first.caret).toBe(first.text.length);
    const again = withLine(first.text, CTA_PREFIX);
    expect(again.text).toBe(first.text); // nothing added twice
    expect(again.caret).toBe(first.text.length);
    expect(withLine("", KEYWORDS_PREFIX).text).toBe("Keywords: ");
  });

  test("the box takes 4000 characters, the same as the request", () => {
    expect(ADAPT_MAX).toBe(4000);
    expect(src("lib/validation.ts")).toContain("text: z.string().trim().min(1).max(4000)");
  });
});

describe("1190 a long video is not a Short", () => {
  test("over three minutes, or landscape", () => {
    expect(LONG_FORM_SEC).toBe(180);
    expect(isLongForm({ duration: 42, width: 1080, height: 1920 })).toBe(false);
    expect(isLongForm({ duration: 600, width: 1080, height: 1920 })).toBe(true);
    expect(isLongForm({ duration: 42, width: 1920, height: 1080 })).toBe(true);
    expect(isLongForm(null)).toBe(false);
  });

  test("the long-form playbook forbids #Shorts and asks for a search title", () => {
    const r = longFormRules(DEFAULT_RULES);
    expect(r.platforms.youtube.label).toContain("not a Short");
    expect(r.platforms.youtube.rules.join(" ")).toContain("never write #Shorts");
    expect(JSON.stringify(r.platforms.youtube.rules)).not.toContain("#Shorts may be added");
    expect(r.platforms.instagram).toEqual(DEFAULT_RULES.platforms.instagram); // nothing else is touched
  });

  test("Pip watches a long video only when asked", () => {
    const w = src("components/create/CreateWorkspace.tsx");
    expect(w).toContain("if (!manual && duration > LONG_FORM_SEC) return setWatch(NO_WATCH);");
    expect(w).toContain("const manual = manualWatch.current;");
    expect(w).toContain("if (submittedRef.current === null) void watchVideo(url);"); // the automatic watch is unchanged
    expect(w).toContain("manualWatch.current = true;");
  });
});

describe("1190 Pip asks instead of guessing", () => {
  test("a sentence is enough; two words are not", () => {
    expect(clarifyFor("I tried the 5am routine for 30 days.")).toBeNull();
    expect(clarifyFor("my bakery")).toContain("Tell me a little more");
    expect(clarifyFor("   ")).toContain("What's the video about?");
    expect(clarifyFor("CTA: follow me")).toContain("What's the video about?"); // a CTA alone is not a message
  });

  test("a full sentence without spaces still counts (20 letters)", () => {
    expect(clarifyFor("ไปเที่ยวเชียงใหม่สามวันกับงบห้าพัน")).toBeNull();
  });

  test("the question is asked once, and asking costs nothing", () => {
    const r = src("app/api/ai/adapt/route.ts");
    const atClarify = r.indexOf("return json({ clarify })");
    const atCharge = r.indexOf("await chargeAi(");
    expect(atClarify).toBeGreaterThan(0);
    expect(atClarify).toBeLessThan(atCharge); // nothing is charged for a question
    expect(r).toContain("const hit = fresh ? null : remembered(key);");
    expect(r.indexOf("if (hit) return json(")).toBeLessThan(atCharge); // the same words again are free
    expect(r).toContain("noClarify");
    expect(r).toContain("limit: [30, 60_000]");
  });

  test("a busy AI is never remembered as the answer", () => {
    expect(src("lib/ai/adapt.ts")).toContain('if (value.source !== "ai") return;');
  });
});

describe("1190 YouTube chapters can only point at real moments", () => {
  const transcript = "00:00 welcome\n00:45 the first week\n03:20 what changed\n07:10 what I would do again";
  const good = [
    { at: "00:00", title: "Welcome" },
    { at: "00:45", title: "The first week" },
    { at: "03:20", title: "What changed" },
  ];

  test("three or more, in order, from the transcript's own timestamps", () => {
    expect(cleanChapters(good, transcript, 600)).toBe("00:00 Welcome\n00:45 The first week\n03:20 What changed");
  });

  test("anything invented or malformed is dropped whole", () => {
    expect(cleanChapters(good.slice(0, 2), transcript, 600)).toBe(""); // fewer than three
    expect(cleanChapters(good.slice(1), transcript, 600)).toBe(""); // does not start at 00:00
    expect(cleanChapters([...good, { at: "03:25", title: "Too close" }], transcript, 600)).toBe("");
    expect(cleanChapters([good[0], { at: "01:30", title: "Not in the video" }, good[2]], transcript, 600)).toBe("");
    expect(cleanChapters(good, transcript, 120)).toBe(""); // past the end of the video
    expect(cleanChapters(good, "", 600)).toBe(""); // no transcript, no chapters
    expect(cleanChapters("00:00 Welcome", transcript, 600)).toBe("");
  });

  test("the transcript Pip reads is the creator's own subtitles, with timestamps", () => {
    expect(timedTranscript([{ start: 0, text: "hello" }, { start: 75, text: "and then" }])).toBe("00:00 hello\n01:15 and then");
    expect(timedTranscript([])).toBe("");
    expect(stamp(3725)).toBe("1:02:05");
  });
});

describe("1190 the no-AI path keeps every word the creator's own", () => {
  const text = "I tried the 5am routine for 30 days and got more done before 9am than I used to all morning.\nCTA: follow for week two\nKeywords: 5am routine, discipline";

  test("the message and the creator's CTA, fitted to each place, nothing added", () => {
    const items = offlineAdapt(text, ["instagram", "x", "youtube"], {});
    const ig = items.find((i) => i.platform === "instagram")!;
    expect(ig.caption).toContain("I tried the 5am routine for 30 days");
    expect(ig.caption).toContain("follow for week two");
    expect(ig.hashtags).toBe("#5amroutine #discipline"); // only the creator's own keywords
    const x = items.find((i) => i.platform === "x")!;
    expect(x.hashtags).toBe("");
    expect(x.caption.length).toBeLessThanOrEqual(PLATFORM_META.x.captionLimit);
    for (const c of items) expect(composedCopy(c.platform, { caption: c.caption, description: c.description ?? "", hashtags: c.hashtags }).length).toBeLessThanOrEqual(PLATFORM_META[c.platform].captionLimit);
  });

  test("a Short keeps #Shorts; a long video never gets it", () => {
    const short = offlineAdapt(text, ["youtube"], {})[0];
    expect(short.hashtags).toContain("#Shorts");
    expect(short.title).toBeTruthy();
    const long = offlineAdapt(text, ["youtube"], { longForm: true })[0];
    expect(long.hashtags.toLowerCase()).not.toContain("#shorts");
    expect(long.description).toContain("follow for week two");
  });

  test("no keywords, no hashtags: nothing is invented to fill the field", () => {
    const [ig] = offlineAdapt("My bakery's busiest morning this year.", ["instagram"], {});
    expect(ig.hashtags).toBe("");
    expect(tagsFrom(["budget travel"], 3)).toBe("#budgettravel");
    expect(tagsFrom(["a"], 3)).toBe("");
    expect(tagsFrom(["one", "two"], 0)).toBe("");
  });

  test("a cut is on a word, with the ellipsis only when something was really cut", () => {
    expect(firstSentence("First one. Second one.")).toBe("First one.");
    const long = offlineAdapt("word ".repeat(120), ["threads"], {})[0];
    expect(long.caption.length).toBeLessThanOrEqual(PLATFORM_META.threads.captionLimit);
    expect(long.caption.endsWith("…")).toBe(true);
  });
});

describe("1190 Step 2: one box, then a card for every place", () => {
  const w = src("components/create/CreateWorkspace.tsx");
  const c = src("components/create/StoryComposer.tsx");
  const a = src("components/create/AdaptedCaptions.tsx");

  test("the composer says what it does, and takes the creator's own words", () => {
    expect(c).toContain("Write once. Outlly adapts it everywhere.");
    expect(c).toContain("What&apos;s your video about?");
    expect(c).toContain("Generate captions with Pip AI");
    expect(c).toContain("Use my text as is");
    expect(c).toContain("Analyze my video for more accurate captions");
    expect(c).toContain("maxLength={ADAPT_MAX}");
    expect(c).toContain("Call to action");
    expect(c).toContain("Keywords");
  });

  test("real progress while it writes, and a way to stop", () => {
    expect(c).toContain("Writing for {Math.min(p.progress!.done + 1, p.progress!.total)} of {p.progress!.total}");
    expect(c).toContain("onClick={p.onStop}");
    expect(w).toContain("progress={adapting ? { done: adaptTotal - adaptWriting.length, total: adaptTotal } : null}");
    expect(w).toContain("const stopAdapt = () => {");
  });

  test("the page streams from the new route and the message stands in as the hook", () => {
    expect(w).toContain('"/api/ai/adapt"');
    expect(w).toContain('if (ev.t === "core" && typeof ev.core === "string" && ev.core.trim()) setHook(ev.core.trim());');
    expect(w).toContain("<StoryComposer");
    expect(w).toContain("<AdaptedCaptions");
  });

  test("an edit of the creator's own is proposed to, never written over", () => {
    expect(w).toContain("const fill = o.direct || untouched(c.platform);");
    expect(w).toContain("else applyCopy([c]);");
    expect(w).toContain("const untouched = (pl: Platform) => {");
    expect(a).toContain("Restore Pip&apos;s version");
  });

  test("each card is editable, counted against the real limit, and approved here", () => {
    expect(a).toContain("PLATFORM_META[platform]");
    expect(a).toContain("composedCopy(platform, d).length");
    expect(a).toContain("<Counter value={bodyLen} max={meta.captionLimit} />");
    expect(a).toContain("meta.titleLimit ?? 100");
    expect(a).toContain("set({ reviewed: !d.reviewed })");
    expect(a).toContain("navigator.clipboard.writeText(text)");
    expect(a).toContain("Regenerate all");
    expect(a).toContain('role="tablist"');
  });

  test("Pip never asks for the same words twice, and says where the box is", () => {
    expect(w).toContain('composer={step === "story" && hasMedia}');
    const asst = src("components/create/Assistant.tsx");
    expect(asst).toContain("const ownBox = askStory && !p.composer;");
    expect(asst).toContain("{ownBox && (\n        <form");
    expect(src("components/create/assistant-state.ts")).toContain("Write what your video is about, then press Generate captions with Pip AI.");
  });

  test("Pip's own version survives a reload, beside the draft in this browser", () => {
    expect(src("lib/client/device-drafts.ts")).toContain("adapted?: unknown;");
    expect(w).toContain("adapted: adaptedRef.current,");
    expect(w).toContain('if (d.adapted && typeof d.adapted === "object") setAdapted(d.adapted as Partial<Record<Platform, PlatformCopy>>);');
  });

  test("the asks for a different take are the same list the model is given", () => {
    expect(ADAPT_TONES.map((t) => t.id)).toEqual(["takeaway", "hook", "professional", "conversational", "shorter"]);
    expect(toneLine("shorter")).toContain("half");
    expect(toneLine(undefined)).toBe("");
    for (const t of ADAPT_TONES) expect(c).toContain("ADAPT_TONES.map");
    expect(src("lib/validation.ts")).toContain('tone: z.enum(["default", "takeaway", "hook", "professional", "conversational", "shorter"]).optional()');
  });

  test("the model is told the creator's words win, and that nothing may be invented", () => {
    const s = src("lib/ai/adapt.ts");
    expect(s).toContain("The creator's text is the only source of truth.");
    expect(s).toContain("Never add a fact, number, result, promise, event, quote or detail that is not in it.");
    expect(s).toContain("Write in the language the creator wrote in.");
    expect(s).toContain("context only; never add claims from it that the creator's text does not make");
  });

  test("what the card shows is what is compared, so an edit is never missed", () => {
    expect(copyKey({ caption: " a ", hashtags: "#b" })).toBe(copyKey({ title: "", caption: "a", description: "", hashtags: "#b" }));
    expect(copyKey({ caption: "a", hashtags: "#b" })).not.toBe(copyKey({ caption: "a", hashtags: "#c" }));
  });

  test("no dashes in the 1190 files", () => {
    for (const f of ["components/create/StoryComposer.tsx", "components/create/AdaptedCaptions.tsx", "lib/ai/adapt-core.ts", "lib/ai/adapt.ts", "app/api/ai/adapt/route.ts"]) {
      expect(src(f)).not.toInclude("\u2014");
      expect(src(f)).not.toInclude("\u2013");
    }
  });
});
