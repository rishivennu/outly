import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");

describe("audit: editors never get a retry they can't use", () => {
  test("chat failed-post card hides Try again for editors", () => {
    const w = src("components/support/ChatWidget.tsx");
    // R1194: the one useMaybeUser() call is shared with signedIn; the rule is unchanged.
    expect(w).toContain("const user = useMaybeUser();");
    expect(w).toContain('const canRetry = user?.workspace?.role !== "editor";');
    expect(w).toMatch(/c\.kind === "failed" && !c\.reconnect && canRetry && \(/);
  });
  test("useMaybeUser is safe outside the studio provider", () => {
    const u = src("components/shell/UserContext.tsx");
    expect(u).toMatch(/export function useMaybeUser\(\) \{\s*return useContext\(Ctx\);\s*\}/);
  });
});
