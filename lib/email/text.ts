/**
 * 1056. Plain-text twin of every HTML email. Mail sent as HTML only is a classic spam signal
 * (SpamAssassin MIME_HTML_ONLY, and Gmail/Outlook filters weigh it too), so each send carries
 * a multipart/alternative text part built from the same HTML. Links keep their URL, hidden
 * preheaders and images are dropped (a title image keeps its alt), table cells read left to right.
 */

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", bull: "\u2022", middot: "\u00b7",
  copy: "\u00a9", reg: "\u00ae", trade: "\u2122", hellip: "\u2026", ndash: "-", mdash: "-",
  rarr: "\u2192", larr: "\u2190", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", zwnj: "", zwj: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");

export function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<(style|script|title)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Hidden preheader (and any other display:none block) is inbox-preview text, not body copy.
  s = s.replace(/<(span|div)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, "");
  // 1073: a title drawn as an image (the Pacifico pill) keeps its words: an image inside an h1 becomes its alt.
  s = s.replace(/(<h1\b[^>]*>)\s*<img\b[^>]*?\balt\s*=\s*"([^"]*)"[^>]*>/gi, "$1$2");
  s = s.replace(/<img\b[^>]*>/gi, "");
  // Source newlines are layout noise in HTML; only tags decide line breaks below.
  s = s.replace(/\s*\n\s*/g, " ");
  s = s.replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_all, _q, href: string, inner: string) => {
    const label = decodeEntities(stripTags(inner)).replace(/\s+/g, " ").trim();
    const url = decodeEntities(href).trim();
    if (!label) return "";
    if (/^mailto:/i.test(url)) return label;
    if (!/^https?:/i.test(url) || label === url || label === url.replace(/^https?:\/\//i, "")) return label;
    return `${label} (${url})`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<\/(p|div|h[1-6]|tr|table|li|ul|ol|blockquote|pre)>/gi, "\n");
  s = s.replace(/<(p|h[1-6]|table|blockquote)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/t[dh]>/gi, "  ");
  s = decodeEntities(stripTags(s));
  const lines = s.split("\n").map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
