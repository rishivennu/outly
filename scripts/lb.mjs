// Outlly load balancer: a dependency-free reverse proxy for N `next start` instances.
//
//   UPSTREAMS=http://127.0.0.1:3041,http://127.0.0.1:3042 LB_PORT=3040 bun scripts/lb.mjs
//
// - least-connections routing (ties broken round-robin)
// - active health checks on /api/health every 5 s; an instance is pulled after 2 misses
//   and put back after 1 good answer
// - passive failover: a refused connection marks the instance down and, for GET/HEAD
//   only, the request is retried once on another instance (never a POST: it may have
//   reached the app)
// - streams bodies both ways, so large uploads and range requests are not buffered
// - keep-alive to upstreams, X-Forwarded-* headers, graceful shutdown
// - overload guard: each instance takes at most LB_MAX_ACTIVE requests at once (default 256);
//   when every instance is full the balancer answers 503 + Retry-After instead of queueing forever
// - timeouts: an instance that accepts a request but sends no headers within LB_TIMEOUT_MS
//   (default 60 s) gets a 504, so one stuck process cannot hold connections open
// - hop-by-hop headers are stripped both ways; X-Forwarded-Proto from a TLS terminator is kept
// - /__lb status is answered only to localhost
// In production prefer nginx or your platform's balancer (deploy/nginx.conf); this is
// the same policy for running a cluster on one machine.
import http from "node:http";

const HOP = ["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"];
const strip = (h) => {
  const out = { ...h };
  for (const k of String(h.connection ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) delete out[k];
  for (const k of HOP) delete out[k];
  return out;
};
const LOCAL = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function startLb({
  port = Number(process.env.LB_PORT ?? 3040),
  upstreams = (process.env.UPSTREAMS ?? "").split(",").filter(Boolean),
  maxActive = Number(process.env.LB_MAX_ACTIVE ?? 256),
  timeoutMs = Number(process.env.LB_TIMEOUT_MS ?? 60_000),
} = {}) {
  if (!upstreams.length) throw new Error("UPSTREAMS is empty");
  const agent = new http.Agent({ keepAlive: true, maxSockets: maxActive, keepAliveMsecs: 30_000 });
  const pool = upstreams.map((u) => ({ url: new URL(u), active: 0, up: true, misses: 0, served: 0 }));
  let rr = 0;

  const pick = (exclude) => {
    const live = pool.filter((p) => p.up && p !== exclude && p.active < maxActive);
    if (!live.length) return null;
    const min = Math.min(...live.map((p) => p.active));
    const best = live.filter((p) => p.active === min);
    return best[rr++ % best.length];
  };

  const check = (p) =>
    new Promise((resolve) => {
      const r = http.get({ host: p.url.hostname, port: p.url.port, path: "/api/health", timeout: 2000, agent }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      r.on("timeout", () => r.destroy());
      r.on("error", () => resolve(false));
    }).then((ok) => {
      if (ok) {
        if (!p.up) console.log(`[lb] ${p.url.host} back up`);
        p.up = true;
        p.misses = 0;
      } else if (++p.misses >= 2 && p.up) {
        p.up = false;
        console.warn(`[lb] ${p.url.host} down`);
      }
    });
  const timer = setInterval(() => pool.forEach(check), 5000);
  pool.forEach(check);

  const forward = (req, res, target, retried) => {
    target.active++;
    target.served++;
    const headers = {
      ...strip(req.headers),
      "x-forwarded-for": [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", "),
      "x-forwarded-host": req.headers["x-forwarded-host"] ?? req.headers.host ?? "",
      "x-forwarded-proto": req.headers["x-forwarded-proto"] ?? "http",
    };
    const up = http.request({ host: target.url.hostname, port: target.url.port, method: req.method, path: req.url, headers, agent }, (ur) => {
      clearTimeout(slow);
      res.writeHead(ur.statusCode ?? 502, { ...strip(ur.headers), "x-outly-upstream": target.url.port });
      ur.pipe(res);
      ur.on("end", done);
    });
    // No response headers in time: give up on this instance for this request.
    let timedOut = false;
    const slow = setTimeout(() => {
      timedOut = true;
      done();
      up.destroy();
      if (res.headersSent) return res.destroy();
      res.writeHead(504, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "GATEWAY_TIMEOUT", message: "That took too long. Try again in a moment." }));
    }, timeoutMs);
    let finished = false;
    function done() {
      if (!finished) {
        finished = true;
        target.active--;
      }
    }
    res.on("close", () => {
      done();
      clearTimeout(slow);
      if (!res.writableFinished) up.destroy(); // client went away: stop the work upstream too
    });
    up.on("error", (e) => {
      done();
      clearTimeout(slow);
      if (timedOut) return;
      if (res.headersSent) return res.destroy(e);
      if (e.code === "ECONNREFUSED" || e.code === "ECONNRESET") {
        target.up = false;
        const idempotent = req.method === "GET" || req.method === "HEAD";
        const next = !retried && idempotent && pick(target);
        if (next) return forward(req, res, next, true);
      }
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "BAD_GATEWAY", message: "No app instance answered. Try again in a moment." }));
    });
    req.pipe(up);
  };

  const server = http.createServer((req, res) => {
    if (req.url === "/__lb" && LOCAL.has(req.socket.remoteAddress ?? "")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify(pool.map((p) => ({ upstream: p.url.host, up: p.up, active: p.active, served: p.served }))));
    }
    const target = pick();
    if (!target) {
      const busy = pool.some((p) => p.up);
      res.writeHead(503, { "content-type": "application/json", "retry-after": busy ? "2" : "5" });
      return res.end(JSON.stringify(busy ? { error: "BUSY", message: "Outlly is very busy right now. Try again in a moment." } : { error: "UNAVAILABLE", message: "Outlly is restarting. Try again in a few seconds." }));
    }
    forward(req, res, target, false);
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 0; // long uploads stream through; the upstream timeout above covers stuck instances
  server.listen(port, () => console.log(`[lb] :${port} -> ${upstreams.join(", ")} (least-connections)`));
  // Graceful: stop accepting, let in-flight requests finish (max 10 s), then drop idle sockets.
  const close = () => {
    clearInterval(timer);
    server.close();
    server.closeIdleConnections?.();
    setTimeout(() => (server.closeAllConnections?.(), agent.destroy()), 10_000).unref();
  };
  return { server, pool, close };
}

if (import.meta.main ?? process.argv[1]?.endsWith("lb.mjs")) {
  const lb = startLb();
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => (lb.close(), process.exit(0)));
}
