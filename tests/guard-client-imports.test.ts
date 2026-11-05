import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 1131 hotfix: a server file (no "use client") that imports a plain value (not a component, not a type) from a
 * "use client" file gets a client reference instead of the value, and the page crashes on the server. /create
 * went down this way when page.tsx read SLIDE_FORMATS from FormatComposer.tsx. Components (Capitalised) are fine.
 */
const root = join(import.meta.dir, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(n) ? [p] : [];
  });
const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);
const resolve = (spec: string) => {
  if (!spec.startsWith("@/")) return null;
  const base = join(root, spec.slice(2));
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};

describe("server files only take components and types from client files", () => {
  test("no plain values imported across the client boundary", () => {
    const bad: string[] = [];
    for (const file of walk(join(root, "app"))) {
      const src = readFileSync(file, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const target = resolve(m[3]);
        if (!target || !isClient(readFileSync(target, "utf8"))) continue;
        for (const raw of m[2].split(",").map((s) => s.trim()).filter(Boolean)) {
          if (raw.startsWith("type ")) continue;
          const name = raw.split(/\s+as\s+/)[0].trim();
          // A component is PascalCase. camelCase values and SCREAMING_CASE constants are not.
          if (!/^[A-Z]/.test(name) || /^[A-Z0-9_]+$/.test(name)) bad.push(`${file.slice(root.length + 1)}: ${name} from ${m[3]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
