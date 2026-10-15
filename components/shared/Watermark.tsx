/**
 * Invisible watermark (10-15). A full-screen layer of repeated "OUTLLY (c) year [tag]" text at about
 * 1% opacity: nobody notices it, but a screenshot run through a levels or curves adjustment shows
 * it, so a copied page can be traced back to Outlly (and, inside the studio, to the account that
 * took it, via a short one-way hash of the user id). Purely visual: aria-hidden, no text nodes,
 * no pointer events, no JS.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const url = (svg: string) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
const tile = (text: string, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="250"><text x="40" y="150" transform="rotate(-22 220 125)" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="700" letter-spacing="2" fill="${fill}">${esc(text)}</text></svg>`;

export function Watermark({ tag }: { tag?: string }) {
  const text = `OUTLLY \u00A9 ${new Date().getFullYear()}${tag ? ` \u00B7 ${tag}` : " \u00B7 ALL RIGHTS RESERVED"}`;
  const style = { "--wm-l": url(tile(text, "#000")), "--wm-d": url(tile(text, "#fff")) } as React.CSSProperties;
  return <div aria-hidden="true" className={tag ? "wm wm-user" : "wm"} style={style} />;
}
