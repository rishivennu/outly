// R1312: Vercel Cron, replayed. Reads the `crons` from vercel.json and calls each path on this very process at the
// same UTC schedule, with the same `Authorization: Bearer CRON_SECRET` header Vercel sent, so /api/cron/* behaves
// exactly as it did there. One instance of each job at a time (a slow sweep is skipped, not stacked). Started by
// scripts/render-start.sh next to `next start`; it waits for /api/health before the first tick.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = process.env.PORT || "10000";
const BASE = process.env.CRON_TARGET || `http://127.0.0.1:${PORT}`;
const SECRET = process.env.CRON_SECRET || "";
const TIMEOUT_MS = Number(process.env.CRON_TIMEOUT_MS || 280_000); // Vercel Pro's 300 s function ceiling, minus slack

// One cron field (star, "5", "1,15", "star/5", "1-5", "1-5/2") as a predicate on a number. Exported for the tests.
export function field(spec, min, max) {
  const parts = spec.split(",").map((p) => {
    const [range, stepRaw] = p.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    let lo = min, hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a; hi = b ?? a;
    }
    if (![lo, hi, step].every(Number.isInteger) || lo < min || hi > max || lo > hi || step < 1) throw new Error(`bad cron field "${spec}"`);
    return (n) => n >= lo && n <= hi && (n - lo) % step === 0;
  });
  return (n) => parts.some((f) => f(n));
}

/** True when a 5-field cron expression (minute hour day month weekday, UTC like Vercel) fires at `date`. */
export function matches(expr, date) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron needs 5 fields: "${expr}"`);
  const [mi, h, dom, mo, dow] = f;
  return (
    field(mi, 0, 59)(date.getUTCMinutes()) &&
    field(h, 0, 23)(date.getUTCHours()) &&
    field(dom, 1, 31)(date.getUTCDate()) &&
    field(mo, 1, 12)(date.getUTCMonth() + 1) &&
    (field(dow, 0, 7)(date.getUTCDay()) || (date.getUTCDay() === 0 && field(dow, 0, 7)(7))) // Sunday is 0 and 7
  );
}

export function loadCrons(file = resolve(process.cwd(), "vercel.json")) {
  const crons = JSON.parse(readFileSync(file, "utf8")).crons ?? [];
  for (const c of crons) matches(c.schedule, new Date()); // validate up front
  return crons;
}

const running = new Set();
async function fire(cron, at) {
  if (running.has(cron.path)) { console.log(`[cron] ${cron.path} still running, skipped tick ${at.toISOString()}`); return; }
  running.add(cron.path);
  const t = Date.now();
  try {
    const r = await fetch(BASE + cron.path, { headers: { authorization: `Bearer ${SECRET}`, "user-agent": "outlly-cron-scheduler/1" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await r.text()).slice(0, 160).replace(/\s+/g, " ");
    console.log(`[cron] ${cron.path} ${r.status} ${Date.now() - t}ms ${body}`);
  } catch (e) {
    console.error(`[cron] ${cron.path} failed after ${Date.now() - t}ms: ${e instanceof Error ? e.message : e}`);
  } finally {
    running.delete(cron.path);
  }
}

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(5000) }); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

export async function main() {
  if (!SECRET) { console.error("[cron] CRON_SECRET is not set: the scheduler does nothing."); return; }
  const crons = loadCrons();
  console.log(`[cron] ${crons.length} jobs from vercel.json, target ${BASE}`);
  if (!(await waitForApp())) console.error("[cron] app never answered /api/health; ticking anyway");
  let last = -1;
  const tick = () => {
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute === last) return;
    last = minute;
    const at = new Date(minute * 60_000);
    for (const c of crons) if (matches(c.schedule, at)) void fire(c, at);
  };
  tick();
  setInterval(tick, 1000).unref?.();
  setInterval(() => {}, 1 << 30); // keep the loop alive
}

if ((process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/cron-scheduler.mjs")) void main();
