import { NextResponse, type NextRequest } from "next/server";
import { readSessionUserId } from "@/lib/auth";
import { APP_CH_COOKIE, APP_DEEP_LINK, returnTarget, signCode, validChallenge } from "@/lib/app-handoff";

export const dynamic = "force-dynamic";

const page = (link: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Back to Outlly</title>
<style>html,body{margin:0;height:100%;background:#0d0d10;color:#f4f4f5;font:16px/1.45 system-ui,-apple-system,Roboto,sans-serif}main{min-height:100dvh;display:grid;place-items:center;padding:24px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#a1a1aa;margin:0 0 24px}a{display:inline-flex;align-items:center;min-height:48px;padding:0 28px;border-radius:999px;background:#c4ff00;color:#0d0d10;font-weight:600;text-decoration:none}a:focus-visible{outline:3px solid #fff;outline-offset:3px}</style></head>
<body><main><div><h1>All done</h1><p>Head back to the Outlly app to carry on.</p><a id="go" href="${link}">Back to Outlly</a></div></main>
<script>try{location.replace(document.getElementById("go").href)}catch(e){}</script></body></html>`;

/** Step 4 (in the Custom Tab): the flow is over. Hand the app a one-time code through outlly://auth. */
export async function GET(req: NextRequest) {
  const ch = req.cookies.get(APP_CH_COOKIE)?.value;
  // The cookie is left to expire rather than deleted: Next's client router fetches this URL once for its
  // own payload before loading it for real, and the second load still has to find it.
  if (!validChallenge(ch)) return NextResponse.redirect(`${APP_DEEP_LINK}?error=expired`);
  const code = await signCode({ uid: await readSessionUserId(), ch, next: returnTarget(req.nextUrl.searchParams) });
  const link = `${APP_DEEP_LINK}?code=${encodeURIComponent(code)}`;
  // Straight off a consent tap Chrome follows a redirect into the app. After the 2FA step the page got here
  // by script, which Chrome won't let open an app on its own, so show a button to tap.
  if (req.headers.get("sec-fetch-user") === "?1") return NextResponse.redirect(link);
  return new NextResponse(page(link), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
