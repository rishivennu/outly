/**
 * R1175: the small Markdown the blog agent writes (headings, paragraphs, lists, task lists, links, emphasis,
 * inline code, quotes, rules) rendered to HTML. Everything is escaped first and only http(s), site-relative and
 * anchor links survive, so the output is safe to set as innerHTML. Client-safe, no dependencies.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeHref = (h: string) => (/^(https?:\/\/|\/|#)/i.test(h.trim()) ? h.trim() : null);

export function inline(src: string): string {
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const h = safeHref(href);
    if (!h) return text;
    const ext = /^https?:\/\//i.test(h);
    return `<a href="${esc(h)}"${ext ? ' target="_blank" rel="noopener noreferrer nofollow"' : ""}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  return s;
}

export const slugHeading = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);

export interface Heading {
  level: 2 | 3;
  text: string;
  id: string;
}

export function renderMarkdown(md: string): { html: string; headings: Heading[] } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const headings: Heading[] = [];
  const ids = new Map<string, number>();
  let para: string[] = [];
  let list: { kind: "ul" | "ol" | "tasks"; items: string[] } | null = null;
  let quote: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.kind === "ol" ? "ol" : "ul";
    out.push(`<${tag}${list.kind === "tasks" ? ' class="tasks"' : ""}>${list.items.join("")}</${tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      flushAll();
      const level = h[1].length <= 2 ? 2 : 3;
      const text = h[2].trim();
      let id = slugHeading(text) || "section";
      const n = (ids.get(id) ?? 0) + 1;
      ids.set(id, n);
      if (n > 1) id = `${id}-${n}`;
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushAll();
      out.push("<hr>");
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (task) {
      flushPara();
      flushQuote();
      if (!list || list.kind !== "tasks") (flushList(), (list = { kind: "tasks", items: [] }));
      const done = task[1] !== " ";
      list.items.push(`<li><input type="checkbox" disabled${done ? " checked" : ""}> <span>${inline(task[2])}</span></li>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      flushPara();
      flushQuote();
      if (!list || list.kind !== "ul") (flushList(), (list = { kind: "ul", items: [] }));
      list.items.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ol) {
      flushPara();
      flushQuote();
      if (!list || list.kind !== "ol") (flushList(), (list = { kind: "ol", items: [] }));
      list.items.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // Continuation line inside a list item.
      list.items[list.items.length - 1] = list.items[list.items.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return { html: out.join("\n"), headings };
}

/** Plain text for excerpts and search snippets. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
