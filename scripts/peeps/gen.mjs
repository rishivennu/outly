import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Peep from "react-peeps";
import { optimize } from "svgo";
import fs from "node:fs";
import { CAST } from "./cast.mjs";

const bbox = JSON.parse(fs.readFileSync("bbox.json", "utf8"));
const PAD = 24;
const FILL_PLACEHOLDER = "#010203";
const out = {};
let total = 0;
for (const [name, c] of Object.entries(CAST)) {
  const [x, y, w, h] = bbox[name];
  const vb = { x: String(x - PAD), y: String(y - PAD), width: String(w + 2 * PAD), height: String(h + 2 * PAD) };
  const raw = renderToStaticMarkup(React.createElement(Peep, { ...c, strokeColor: "currentColor", backgroundColor: FILL_PLACEHOLDER, viewBox: vb }));
  const { data } = optimize(raw, {
    multipass: true,
    floatPrecision: 1,
    plugins: [{ name: "preset-default", params: { overrides: { convertColors: false } } }, "removeDimensions"],
  });
  const m = data.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
  if (!m) throw new Error("unexpected svg shape for " + name);
  // A few parts carry a fixed colour of their own (PointingUp's sweater pattern is #4F66AF): that becomes paper too.
  const markup = m[2].replaceAll(`fill="${FILL_PLACEHOLDER}"`, 'fill="var(--peep-fill)"').replace(/fill="#[0-9a-fA-F]{3,8}"/g, 'fill="var(--peep-fill)"');
  if (/#[0-9a-f]{3,8}\b/i.test(markup)) throw new Error("fixed colour left in " + name);
  if (/<(?!\/?(path|g)\b)/.test(markup)) throw new Error("unexpected element in " + name);
  if (/<script|on[a-z]+=|href=|<image|<foreignObject/i.test(markup)) throw new Error("unsafe content in " + name);
  out[name] = { viewBox: m[1], markup };
  total += markup.length;
  console.log(name.padEnd(12), "raw", String(raw.length).padStart(6), "opt", String(markup.length).padStart(6), "vb", m[1]);
}
console.log("total markup bytes", total);
fs.writeFileSync("peeps.json", JSON.stringify(out));
// The repo module: one server-only data file, strings only (no JSX attribute translation, no client bundle).
const esc = (s) => s.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
let ts = `import "server-only";

/**
 * R1295: the Outlly cast, eleven Open Peeps (CC0, openpeeps.com) composed from the mix-and-match parts through
 * react-peeps (MIT) and run through SVGO, so no two look like anyone else's. Ink is \`currentColor\`, the paper
 * areas are \`var(--peep-fill)\`; the Peep component sets both. Markup is static and trusted (paths and groups only,
 * checked by tests/round-1295-peeps.test.ts). Regenerate with scripts/peeps (see its README), never edit by hand.
 */
export const PEEP_NAMES = [${Object.keys(out).map((k) => JSON.stringify(k)).join(", ")}] as const;
export type PeepName = (typeof PEEP_NAMES)[number];

export const PEEPS: Record<PeepName, { viewBox: string; markup: string }> = {
`;
for (const [k, v] of Object.entries(out)) ts += `  ${k}: {\n    viewBox: ${JSON.stringify(v.viewBox)},\n    markup:\n      \`${esc(v.markup)}\`,\n  },\n`;
ts += "};\n";
fs.writeFileSync("data.ts", ts);
console.log("data.ts bytes", ts.length);

// A gallery to judge the treatment: light card, dark card, pastel tile with white fill, pastel tile with tile fill.
const cell = (name, bg, ink, fill, label) => `<figure style="background:${bg};color:${ink};--peep-fill:${fill}"><svg viewBox="${out[name].viewBox}" aria-hidden="true">${out[name].markup}</svg><figcaption>${name} ${label}</figcaption></figure>`;
let html = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#888;font:12px system-ui}.g{display:grid;grid-template-columns:repeat(11,1fr);gap:8px;padding:8px}figure{margin:0;border-radius:14px;padding:8px;text-align:center}svg{height:170px;width:100%}figcaption{opacity:.8}</style>`;
const rows = [
  ["#ffffff", "#111114", "hsl(78 92% 50%)", "light/lime"],
  ["#0f0f12", "#f4f4f5", "hsl(78 100% 55%)", "dark/lime"],
  ["#bbd6ea", "#1f3a52", "#ffffff", "sky/white"],
  ["#f7e6a3", "#5a4300", "#f7e6a3", "butter/tile"],
  ["#f5b6cc", "#5b1d38", "#ffffff", "blush/white"],
];
for (const [bg, ink, fill, label] of rows) html += `<div class="g">` + Object.keys(out).map((n) => cell(n, bg, ink, fill, label)).join("") + `</div>`;
fs.writeFileSync("gallery.html", html);
