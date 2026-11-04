/**
 * Runs in a child process with NODE_ENV=production (the test runner itself is always NODE_ENV=test), so the
 * production rule can be executed rather than argued about: the simulated gateway must not sell a plan on a
 * live site unless the owner opted in with ALLOW_MOCK_PAYMENTS=true.
 * Usage: bun tests/helpers/prod-mock-probe.ts <userId>   ->  {"mockAllowed":false,"code":"GATEWAY"}
 */
import { mock } from "bun:test";
mock.module("server-only", () => ({}));

const userId = process.argv[2] ?? "";
const svc = await import("../../lib/billing/service");
let code = "started";
try {
  await svc.startCheckout(userId, "creator");
} catch (e) {
  code = (e as { code?: string }).code ?? (e as Error).message;
}
console.log("PROBE " + JSON.stringify({ mockAllowed: svc.mockAllowed(), code }));
