// R1312: copy the Vercel production environment to a Render service, 1:1.
//   bunx vercel env pull .env.vercel --environment=production     (then)
//   RENDER_API_KEY=... node scripts/render-env.mjs <serviceId> .env.vercel [--dry]
// Vercel's own variables (VERCEL, VERCEL_*, NX_DAEMON, TURBO_*) are dropped: the app's RENDER branches take over
// (instrumentation-node.ts, lib/http.ts, lib/db.ts). Everything else keeps its exact name and value. Replaces the
// service's whole env in one PUT, so a re-run is idempotent. Prints names only, never values.
import { readFileSync } from "node:fs";

/** .env parser for what `vercel env pull` writes: KEY="value" with \n escapes, KEY=value, comments, blank lines. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const VERCEL_ONLY = /^(VERCEL|VERCEL_.*|NX_DAEMON|TURBO_.*|NEXT_PUBLIC_VERCEL_.*)$/;
/** Pinned on Render regardless of what Vercel had (render.yaml fixed values). */
const PINNED = { DATABASE_PROVIDER: "postgresql", PORT: "10000", NEXT_TELEMETRY_DISABLED: "1", FFMPEG_PATH: "/usr/bin/ffmpeg", FFPROBE_PATH: "/usr/bin/ffprobe", APP_URL: "https://www.outlly.com" };

export function plan(vars) {
  const kept = Object.fromEntries(Object.entries(vars).filter(([k]) => !VERCEL_ONLY.test(k)));
  const dropped = Object.keys(vars).filter((k) => VERCEL_ONLY.test(k));
  return { env: { ...kept, ...PINNED }, dropped };
}

export async function main(argv = process.argv.slice(2)) {
  const [serviceId, file] = argv.filter((a) => !a.startsWith("--"));
  const DRY = argv.includes("--dry");
  const KEY = process.env.RENDER_API_KEY;
  if (!serviceId || !file) { console.error("usage: node scripts/render-env.mjs <serviceId> <envfile> [--dry]"); process.exit(2); }
  if (!KEY && !DRY) { console.error("RENDER_API_KEY is not set"); process.exit(2); }
  const { env, dropped } = plan(parseEnv(readFileSync(file, "utf8")));
  console.log(`${Object.keys(env).length} variables -> ${serviceId}; dropped (Vercel-only): ${dropped.join(", ") || "none"}`);
  console.log(Object.keys(env).sort().join(" "));
  if (DRY) return;
  const body = Object.entries(env).map(([key, value]) => ({ key, value }));
  const r = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    method: "PUT",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.error(`Render API ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  console.log(`Render API ${r.status}: environment replaced (${body.length} variables). Trigger a deploy for it to apply.`);
}

if ((process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/render-env.mjs")) await main();
