/**
 * Round 1151: "Transcribe with AI" failed with a raw "Failed to fetch". The live CSP had no blob: in connect-src,
 * so reading the just-uploaded video back from its local object URL was blocked. Now the policy allows it, and the
 * transcriber reads the creator's own file directly whenever it still has it, so it needs no network read at all.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildCsp } from "@/lib/csp";

const src = (p: string) => readFileSync(p, "utf8");

describe("1151 captions transcribe", () => {
  test("production CSP lets the page read its own blob: video", () => {
    const connect = buildCsp("n", false).split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(connect.split(" ")).toContain("blob:");
    expect(connect).toContain("'self'");
  });

  test("CaptionBurner transcribes the local file when it has one", () => {
    const b = src("components/create/CaptionBurner.tsx");
    expect(b).toContain("file?: Blob | null;");
    // Phase 4: the run lives in the workspace caption store, fed the same file by the editor.
    expect(src("components/create/captions/run-store.ts")).toContain("audioChunks(file ?? src, ctrl.signal)");
    expect(b).toContain("store.attach({ key, src, file, filename, duration, initialTrack })");
    const w = src("components/create/CreateWorkspace.tsx");
    expect(w).toContain("file={preCaption ? preCaption.file : fileRef.current}");
  });

  test("a failed read back says what to do, never a raw 'Failed to fetch'", () => {
    const c = src("lib/client/captions.ts");
    expect(c).toContain("We couldn't read this video back to transcribe it.");
    expect(c).toContain("throw new Error(unreadable);");
  });
});
