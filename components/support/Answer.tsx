import { Fragment } from "react";

/**
 * Tiny, safe renderer for FAQ answers. No HTML is ever injected. Supports:
 *   blank line = new paragraph · **bold** · [text](https://link)
 *   ![alt](https://image.png) on its own line = illustration
 *   [video](https://….mp4 | youtube link) on its own line = explainer clip
 */
const SAFE = (u: string) => /^(https:\/\/|\/)[^\s"'<>]+$/i.test(u);

/**
 * Pip data answers (1125): numbers that carry the answer are set bold. A number counts when it has a unit or
 * shape that marks it as a metric (%, x, pts, currency, a sign, a thousands comma, a decimal) or is followed
 * by what it counts (posts, views...). Dates, years and spans ("last 90 days") stay regular.
 */
const NUM = /[+\-\u2212]?(?:[\u20b9$\u20ac\u00a3]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|x\b|pts\b|[KkMm]\b)|\s(?:percent|per cent|points?)\b)?(?:\s(?:posts?|views?|followers?|subscribers?|likes?|comments?|shares?|saves?|interactions?|videos?|reels?|invoices?|payments?|times)\b)?/g;
const isMetric = (s: string) => /[%x\u20b9$\u20ac\u00a3+\-\u2212,.]|pts|[KkMm]$|[a-z]{3,}$/.test(s.trim()) && !/^(19|20)\d\d$/.test(s.trim());
export function emphasiseNumbers(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NUM)) {
    // A trailing full stop or comma belongs to the sentence, not the number ("Oct 1, 2026" stays regular).
    const tok = m[0].replace(/[.,]+$/, "");
    if (m.index == null || !isMetric(tok)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${key}-${m.index}`} className="pc-num">{tok}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(text: string, nums = false) {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...(nums ? emphasiseNumbers(text.slice(last, m.index), last) : [text.slice(last, m.index)]));
    if (m[1]) out.push(<strong key={m.index} className="font-semibold text-foreground">{m[1]}</strong>);
    else if (SAFE(m[3])) out.push(<a key={m.index} href={m[3]} className="font-medium text-foreground underline decoration-lime decoration-2 underline-offset-4" {...(m[3].startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{m[2]}</a>);
    else out.push(m[2]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...(nums ? emphasiseNumbers(text.slice(last), last) : [text.slice(last)]));
  return out;
}

/** The first sentence of a longer data answer is the takeaway, so it is set a step heavier; the rest stays regular. */
function splitLead(t: string): [string, string] | null {
  const m = /^(.+?[.!?])\s+(?=[A-Z"\u201c])/.exec(t);
  return m && m[0].length < t.length ? [m[1], t.slice(m[0].length)] : null;
}

function youtube(u: string) {
  const m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

export function Answer({ text, className, emphasis = false }: { text: string; className?: string; emphasis?: boolean }) {
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
        const lead = emphasis && i === 0 && !t.includes("\n") ? splitLead(t) : null;
        if (lead)
          return (
            <p key={i}>
              <span className="pc-lead">{inline(lead[0], true)}</span> {inline(lead[1], true)}
            </p>
          );
        return (
          <p key={i} className={i ? "mt-3" : undefined}>
            {t.split("\n").map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line, emphasis)}</Fragment>)}
          </p>
        );
      })}
    </div>
  );
}
