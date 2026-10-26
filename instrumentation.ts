export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

/**
 * Server errors in one log line each (page renders, server actions, route handlers), with the path and the
 * kind of route, so a production failure is findable in Vercel logs. Next 15 calls this hook; on 14 the
 * process handlers in instrumentation-node.ts and the [route] logger in lib/http.ts cover the same ground.
 */
export function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  const e = err as { message?: string; digest?: string; stack?: string };
  console.error(
    "[request-error]",
    JSON.stringify({ method: request.method, path: request.path, route: context.routePath, type: context.routeType, digest: e?.digest, message: e?.message }),
    e?.stack ?? "",
  );
}
