import { ImageResponse } from "next/og";
import { TITLE_INK, titleLayout, verifyTitleSig } from "@/lib/email/title-layout";

/**
 * 1073. Draws an email title in Pacifico with a hand-drawn underline, as a transparent 2x PNG.
 * GET /api/email/title?t=<title>&s=<sig>. The signature is an HMAC of the title (made in lib/email when the
 * email is built), so this can't be used to put arbitrary words in Outlly's lettering on our domain.
 * A given title always draws the same, so the CDN keeps it for a year.
 */
export const runtime = "edge";

const font = fetch(new URL("./Pacifico-email.ttf", import.meta.url)).then((r) => r.arrayBuffer());

/** The mockup's brush stroke (drawn for 300 wide), re-plotted for any width so the stroke never stretches. */
const swash = (w: number) => {
  const x = (f: number) => (f * w).toFixed(1);
  return `M8 13 C ${x(0.267)} 3, ${x(0.633)} 3, ${w - 8} 10 C ${x(0.733)} 7, ${x(0.4)} 9, ${x(0.133)} 17`;
};

// AUTH_SECRET is trimmed the way lib/env-clean trims it on the Node side, so a pasted trailing newline can't split them.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const t = q.get("t") ?? "";
  const L = titleLayout(t);
  if (!L || !(await verifyTitleSig(t, q.get("s") ?? "", process.env.AUTH_SECRET?.trim()))) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const X = 2;
  const w = L.swashW;
  const sw = w * X;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `rotate(${L.rotate}deg)` }}>
          {L.lines.map((line, i) => (
            <div key={i} style={{ display: "flex", fontFamily: "Pacifico", fontSize: L.size * X, lineHeight: `${L.lineH * X}px`, height: L.lineH * X, color: TITLE_INK, whiteSpace: "nowrap" }}>
              {line}
            </div>
          ))}
        </div>
        <svg width={sw} height={20 * X} viewBox={`0 0 ${w} 20`} style={{ marginTop: 10 * X, marginLeft: 14 * X }}>
          <path d={swash(w)} fill="none" stroke={TITLE_INK} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    {
      width: L.w * X,
      height: L.h * X,
      fonts: [{ name: "Pacifico", data: await font, style: "normal", weight: 400 }],
      headers: { "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" },
    },
  );
}
