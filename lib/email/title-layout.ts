/**
 * 1073. Email titles are drawn in Pacifico, the script from the retro restyle. Gmail and Outlook drop web
 * fonts, so the title is a PNG from /api/email/title and the real words ride along as alt text.
 *
 * This file is shared by the template (Node) and the image route (edge), so both agree on the line breaks
 * and the image height without measuring anything at send time. It must stay free of Node-only imports.
 */

/** Pacifico advance widths in font units (1000 per em), for every character the subset font can draw. */
const RAW = "20:265,21:340,22:510,23:700,24:524,25:896,26:851,27:290,28:613,29:613,2a:520,2b:700,2c:257,2d:403,2e:257,2f:509,30:543,31:376,32:560,33:520,34:577,35:518,36:541,37:497,38:512,39:541,3a:257,3b:257,3c:700,3d:700,3e:700,3f:476,40:1015,41:786,42:827,43:686,44:836,45:686,46:712,47:811,48:873,49:495,4a:743,4b:937,4c:673,4d:1232,4e:884,4f:816,50:805,51:816,52:880,53:693,54:697,55:890,56:763,57:1217,58:712,59:851,5a:721,5b:405,5c:509,5d:405,5e:700,5f:354,60:600,61:470,62:473,63:368,64:515,65:393,66:371,67:479,68:502,69:246,6a:254,6b:525,6c:326,6d:744,6e:496,6f:451,70:481,71:500,72:455,73:427,74:393,75:462,76:449,77:700,78:529,79:479,7a:445,7b:490,7c:326,7d:490,7e:700,a0:265,a1:340,a2:466,a3:525,a4:700,a5:497,a6:326,a7:607,a8:600,a9:647,aa:393,ab:615,ac:700,ad:403,ae:647,af:600,b0:385,b1:700,b2:450,b3:450,b4:600,b5:462,b6:739,b7:257,b8:600,b9:450,ba:408,bb:615,bc:955,bd:1024,be:1035,bf:476,c0:786,c1:786,c2:786,c3:786,c4:786,c5:786,c6:1015,c7:686,c8:686,c9:686,ca:686,cb:686,cc:495,cd:495,ce:495,cf:495,d0:821,d1:884,d2:816,d3:816,d4:816,d5:816,d6:816,d7:700,d8:816,d9:890,da:890,db:890,dc:890,dd:851,de:776,df:596,e0:470,e1:470,e2:470,e3:470,e4:470,e5:470,e6:653,e7:368,e8:393,e9:393,ea:393,eb:393,ec:246,ed:246,ee:246,ef:246,f0:451,f1:496,f2:451,f3:451,f4:451,f5:451,f6:451,f7:700,f8:459,f9:462,fa:462,fb:462,fc:462,fd:479,fe:508,ff:479,100:786,101:470,102:786,103:470,104:786,105:470,106:686,107:368,108:686,109:368,10a:686,10b:368,10c:686,10d:368,10e:836,10f:470,110:821,111:470,112:686,113:393,114:686,115:393,116:686,117:393,118:686,119:393,11a:686,11b:393,11c:811,11d:479,11e:811,11f:479,120:811,121:479,122:811,123:479,124:873,125:502,126:856,127:502,128:495,129:246,12a:495,12b:246,12c:495,12d:246,12e:495,12f:246,130:495,131:246,134:743,135:254,136:937,137:525,138:465,139:673,13a:326,13b:673,13c:326,13d:673,13e:237,13f:673,140:363,141:673,142:326,143:884,144:496,145:884,146:496,147:884,148:496,149:496,14a:884,14b:495,14c:816,14d:451,14e:816,14f:451,150:816,151:451,152:1124,153:668,154:880,155:455,156:880,157:455,158:880,159:455,15a:693,15b:427,15c:693,15d:427,15e:693,15f:427,160:693,161:427,162:697,163:393,164:697,165:343,166:697,167:343,168:890,169:462,16a:890,16b:462,16c:890,16d:462,16e:890,16f:462,170:890,171:462,172:890,173:462,174:1217,175:700,176:851,177:479,178:851,179:721,17a:445,17b:721,17c:445,17d:721,17e:445,2018:237,2019:236,201a:257,201c:457,201d:456,201e:477,2022:512,2026:777,20ac:552,20b9:511";
const W = new Map<number, number>(RAW.split(",").map((e) => { const [cp, w] = e.split(":"); return [parseInt(cp, 16), Number(w)]; }));

/** Width the title gets inside the pill on desktop (CSS px). The image scales down on phones. */
export const TITLE_W = 440;
/** Room for the -3deg tilt and the swash tails: lines are broken to fit inside this. */
const FIT_W = 412;
export const TITLE_INK = "#23170f";

export interface TitleLayout {
  lines: string[];
  /** Font size in CSS px (the PNG is drawn at 2x). */
  size: number;
  lineH: number;
  /** Tilt in degrees. */
  rotate: number;
  /** CSS px. */
  w: number;
  h: number;
  /** Width of the underline swash, CSS px. */
  swashW: number;
}

const width = (s: string, size: number) => {
  let u = 0;
  for (const ch of s) u += W.get(ch.codePointAt(0)!) ?? 600;
  return (u / 1000) * size;
};

/** Greedy word wrap at one size. Null when a single word is too wide on its own. */
function wrapAt(words: string[], size: number): string[] | null {
  const out: string[] = [];
  let cur = "";
  for (const wd of words) {
    if (width(wd, size) > FIT_W) return null;
    const next = cur ? `${cur} ${wd}` : wd;
    if (width(next, size) <= FIT_W) cur = next;
    else {
      out.push(cur);
      cur = wd;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** True when Pacifico has a glyph for every character (no emoji, no Devanagari, no CJK). */
export const scriptable = (t: string) => [...t].every((ch) => W.has(ch.codePointAt(0)!));

/**
 * Picks the biggest size that fits in at most 2 lines (3 for long ones). Null means "don't draw it":
 * the email then shows the title as live Bricolage text, as before.
 */
export function titleLayout(raw: string): TitleLayout | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || t.length > 90 || !scriptable(t)) return null;
  const words = t.split(" ");
  for (const [size, max] of [[40, 1], [40, 2], [34, 2], [30, 3]] as const) {
    const lines = wrapAt(words, size);
    if (!lines || lines.length > max) continue;
    const lineH = Math.round(size * 1.45);
    const longest = Math.max(...lines.map((l) => width(l, size)));
    const rotate = lines.length === 1 ? -3 : -2;
    const h = 8 + lines.length * lineH + (lines.length === 1 ? 8 : 10) + 36;
    return { lines, size, lineH, rotate, w: TITLE_W, h, swashW: Math.round(Math.min(320, Math.max(150, longest * 0.72))) };
  }
  return null;
}

/** What the HMAC covers. Versioned so a later redesign can change the drawing without old links breaking. */
export const titleSigInput = (t: string) => `email-title:v1:${t}`;
/** Signatures are cut to 22 base64url characters (132 bits): plenty against forgery, short in the URL. */
export const SIG_LEN = 22;

const b64url = (buf: ArrayBuffer) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * The image route's check, in Web Crypto so it runs on the edge. Must match lib/crypto hmac() (HMAC-SHA256 with
 * AUTH_SECRET, base64url) cut to SIG_LEN; tests/email-template.test.ts proves the two agree.
 */
export async function verifyTitleSig(t: string, sig: string, secret: string | undefined): Promise<boolean> {
  if (!secret || sig.length !== SIG_LEN) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = b64url(await crypto.subtle.sign("HMAC", key, enc.encode(titleSigInput(t)))).slice(0, SIG_LEN);
  let diff = 0;
  for (let i = 0; i < SIG_LEN; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
