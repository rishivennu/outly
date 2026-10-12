import { Fragment } from "react";

/**
 * Tiny, safe renderer for FAQ answers. No HTML is ever injected. Supports:
 *   blank line = new paragraph · **bold** · [text](https://link)
 *   ![alt](https://image.png) on its own line = illustration
 *   [video](https://….mp4 | youtube link) on its own line = explainer clip
 */
const SAFE = (u: string) => /^(https:\/\/|\/)[^\s"'<>]+$/i.test(u);

function inline(text: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} className="font-semibold text-foreground">{m[1]}</strong>);
    else if (SAFE(m[3])) out.push(<a key={m.index} href={m[3]} className="font-medium text-foreground underline decoration-lime decoration-2 underline-offset-4" {...(m[3].startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{m[2]}</a>);
    else out.push(m[2]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function youtube(u: string) {
  const m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

export function Answer({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const t = b.trim();
        const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        if (img && SAFE(img[2])) return <img key={i} src={img[2]} alt={img[1]} loading="lazy" className="my-3 w-full max-w-lg rounded-2xl hairline" />;
        const vid = t.match(/^\[video\]\(([^)\s]+)\)$/i);
        if (vid && SAFE(vid[1])) {
          const yt = youtube(vid[1]);
          return yt ? (
            <div key={i} className="my-3 aspect-video w-full max-w-lg overflow-hidden rounded-2xl hairline">
              <iframe src={yt} title="Explainer video" loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen className="h-full w-full" />
            </div>
          ) : (
            <video key={i} src={vid[1]} controls preload="metadata" playsInline className="my-3 w-full max-w-lg rounded-2xl hairline" />
          );
        }
        return (
          <p key={i} className={i ? "mt-3" : undefined}>
            {t.split("\n").map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line)}</Fragment>)}
          </p>
        );
      })}
    </div>
  );
}
