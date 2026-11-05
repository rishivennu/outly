/* Generate public/brand/platforms/{p}-192.png from the same brand marks the app draws
   (components/brand/brands.tsx BRAND_PATH + TILE). Run once; the PNGs are committed. */
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..");
const src = readFileSync(join(ROOT, "components/brand/brands.tsx"), "utf8").replace(/\r\n/g, "\n");
const block = src.slice(src.indexOf("export const BRAND_PATH"), src.indexOf("} as const;"));
const paths = Object.fromEntries([...block.matchAll(/\n  (\w+):\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]));

const TILE = {
  instagram: ["GRAD", "#fff", 0.58],
  youtube: ["#ffffff", "#FF0000", 0.66],
  x: ["#000000", "#ffffff", 0.5],
  tiktok: ["#000000", "#ffffff", 0.54],
  threads: ["#000000", "#ffffff", 0.56],
  facebook: ["#ffffff", "#0866FF", 0.7],
  linkedin: ["#0A66C2", "#ffffff", 0.52],
};
const GRAD =
  '<defs><radialGradient id="g" cx="0.3" cy="1.07" r="1.3"><stop offset="0%" stop-color="#fdf497"/><stop offset="5%" stop-color="#fdf497"/><stop offset="45%" stop-color="#fd5949"/><stop offset="60%" stop-color="#d6249f"/><stop offset="90%" stop-color="#285AEB"/></radialGradient></defs>';

const S = 192;
const R = (S * 0.225).toFixed(2);
const out = join(ROOT, "public/brand/platforms");
mkdirSync(out, { recursive: true });
for (const [p, [bg, fg, scale]] of Object.entries(TILE)) {
  const d = paths[p];
  if (!d) throw new Error(`no path for ${p}`);
  const side = S * scale;
  const off = ((S - side) / 2).toFixed(3);
  const k = (side / 24).toFixed(6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${bg === "GRAD" ? GRAD : ""}<rect width="${S}" height="${S}" rx="${R}" ry="${R}" fill="${bg === "GRAD" ? "url(#g)" : bg}"/><g transform="translate(${off},${off}) scale(${k})"><path d="${d}" fill="${fg}"/></g></svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(out, `${p}-192.png`));
  console.log("wrote", p);
}
