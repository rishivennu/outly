/* Generate public/brand/platforms/{p}-192.png (the notification icons) from the platforms' own logos in
   public/brand/logos, dressed the way components/brand/brands.tsx AppIcon dresses them (LOGO_TILE): a logo that is
   a tile already fills the tile; the rest sit on a white tile. Run once after a logo changes; the PNGs are committed. */
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..");
const LOGOS = join(ROOT, "public/brand/logos");
const out = join(ROOT, "public/brand/platforms");

/** Same as LOGO_TILE in components/brand/brands.tsx. */
const TILE = {
  instagram: { fill: true, s: 1 },
  threads: { fill: true, s: 1 },
  linkedin: { fill: true, s: 1 },
  youtube: { s: 0.68 },
  facebook: { s: 0.7 },
  x: { s: 0.5 },
  tiktok: { s: 0.56 },
};

const S = 192;
const R = (S * 0.225).toFixed(2);
const rounded = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="${R}" ry="${R}" fill="${fill}"/></svg>`);

for (const [p, t] of Object.entries(TILE)) {
  const logo = join(LOGOS, `${p}.webp`);
  let img;
  if (t.fill) {
    const art = await sharp(logo).resize(S, S, { fit: "cover" }).png().toBuffer();
    img = sharp(art).composite([{ input: rounded("#000"), blend: "dest-in" }]);
  } else {
    const side = Math.round(S * t.s);
    const art = await sharp(logo).resize(side, side, { fit: "inside" }).png().toBuffer();
    img = sharp(rounded("#fff")).composite([{ input: art, gravity: "center" }]);
  }
  await img.png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 }).toFile(join(out, `${p}-192.png`));
  console.log("wrote", p);
}
