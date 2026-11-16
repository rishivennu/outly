import { env } from "@/lib/env";

/** The IndexNow key file: engines fetch it from the keyLocation we send, to prove we own the host. */
export function GET() {
  const key = env.INDEXNOW_KEY.trim();
  if (!key) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
