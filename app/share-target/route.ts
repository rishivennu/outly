import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** Shared text or a link becomes the story on Create, trimmed to something sensible. */
function storyFrom(f: { title?: string | null; text?: string | null; url?: string | null }) {
  return [f.title, f.text, f.url].map((s) => (s ?? "").trim()).filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join("\n").slice(0, 600);
}

function toCreate(req: NextRequest, story: string, missed: boolean) {
  const u = new URL("/create", req.url);
  if (story) u.searchParams.set("text", story);
  if (missed) u.searchParams.set("shared", "missed");
  return NextResponse.redirect(u, 303);
}

/**
 * Fallback for the share sheet when the service worker didn't catch the POST (first launch, or an
 * old worker). Text survives the redirect; a video can't, so Create asks for it again.
 */
export async function POST(req: NextRequest) {
  let story = "";
  let missed = false;
  try {
    const form = await req.formData();
    story = storyFrom({ title: form.get("title") as string | null, text: form.get("text") as string | null, url: form.get("url") as string | null });
    missed = form.getAll("media").some((m) => typeof m !== "string");
  } catch {
    /* empty or malformed share: just open Create */
  }
  return toCreate(req, story, missed);
}

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return toCreate(req, storyFrom({ title: q.get("title"), text: q.get("text"), url: q.get("url") }), false);
}
