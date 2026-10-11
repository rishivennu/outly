// Run Outly as a small cluster on one machine: N `next start` instances + the load balancer.
//
//   bun run build && bun run cluster            # size from CLUSTER_SIZE, default min(4, cores/2)
//
// Safety: without REDIS_URL the job queue and scheduler run inside each web process,
// so two instances would both run the scheduler and could publish a post twice. In that
// case the cluster refuses to start more than one instance. Set REDIS_URL and run
// `bun run worker` separately, then every web instance is stateless and safe to scale.
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startLb } from "./lb.mjs";

const root = join(import.meta.dir ?? new URL(".", import.meta.url).pathname, "..");
const envFile = join(root, ".env");
const fileEnv = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])) : {};
const redis = process.env.REDIS_URL || fileEnv.REDIS_URL;

let size = Number(process.env.CLUSTER_SIZE) || Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));
if (size > 1 && !redis) {
  console.warn("[cluster] REDIS_URL is not set: the in-process queue would run once per instance and could double-publish. Starting 1 instance. Set REDIS_URL and run `bun run worker` to scale out.");
  size = 1;
}

const port = Number(process.env.PORT ?? 3040);
const bin = join(root, "node_modules", ".bin", process.platform === "win32" ? "next.exe" : "next");
const ports = Array.from({ length: size }, (_, i) => port + 1 + i);
const kids = new Map();
let stopping = false;

function launch(p, attempt = 0) {
  const child = spawn(bin, ["start", "-p", String(p)], { cwd: root, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, PORT: String(p) } });
  kids.set(p, child);
  child.on("exit", (code) => {
    if (stopping) return;
    const wait = Math.min(30_000, 1000 * 2 ** attempt);
    console.warn(`[cluster] instance :${p} exited (${code}); restarting in ${wait / 1000}s`);
    setTimeout(() => launch(p, attempt + 1), wait);
  });
}

ports.forEach((p) => launch(p));
const lb = startLb({ port, upstreams: ports.map((p) => `http://127.0.0.1:${p}`) });
console.log(`[cluster] ${size} instance(s) on ${ports.join(", ")}; open http://localhost:${port} (status: /__lb)`);

for (const s of ["SIGINT", "SIGTERM"]) {
  process.on(s, () => {
    stopping = true;
    lb.close();
    for (const k of kids.values()) k.kill();
    process.exit(0);
  });
}
