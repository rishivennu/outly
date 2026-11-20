export const dynamic = "force-dynamic";

/** R1283: the build this server runs. An installed app compares it with the build its page came from (FreshOnResume). */
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD || "dev" }, { headers: { "cache-control": "no-store" } });
}
