/*
 * Seed the demo login. Run: bun run db:seed
 * By default the user starts clean: no connected accounts and no posts, so you connect your own real accounts.
 * SEED_SAMPLES=1 bun run db:seed adds rehearsal accounts and practice posts (only useful with MOCK_SOCIAL_PUBLISHING=true).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const db = new PrismaClient();
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
if (KEY.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY missing");
function enc(s: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

const DAY = 864e5;
const now = new Date();
const at = (dayOffset: number, h: number, m = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
};

// Poster thumbnails: one hue family each (tone-on-tone), big editorial type.
function poster(title: string, kicker: string, a: string, b: string, c: string) {
  const words = title.toUpperCase().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 11) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  lines.push(cur.trim());
  const tspans = lines.map((l, i) => `<tspan x="64" dy="${i === 0 ? 0 : 112}">${l.replace(/&/g, "&amp;")}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
<defs>
<radialGradient id="g" cx="70%" cy="28%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0"/></filter>
</defs>
<rect width="720" height="1280" fill="url(#g)"/>
<circle cx="560" cy="330" r="230" fill="${a}" opacity="0.55"/>
<circle cx="600" cy="300" r="120" fill="#fff" opacity="0.12"/>
<path d="M-40 980 C 180 860, 420 1120, 760 940 L 760 1280 L -40 1280 Z" fill="${c}" opacity="0.65"/>
<rect width="720" height="1280" filter="url(#n)"/>
<text x="64" y="132" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="6" fill="#fff" opacity="0.8">${kicker.toUpperCase()}</text>
<text x="64" y="${1080 - (lines.length - 1) * 112}" font-family="Helvetica, Arial, sans-serif" font-size="104" font-weight="900" letter-spacing="-4" fill="#fff">${tspans}</text>
</svg>`;
}

const SAMPLES = [
  { slug: "instagram-burbn", title: "They deleted 90% of their app", kicker: "Startup stories", colors: ["#ff8a5c", "#d6246e", "#3b0a45"], dur: 47, story: "It's about how Instagram went from a complicated app called Burbn to becoming a billion-dollar company.", hook: "They deleted 90% of their app…\nand that's what made them $1 BILLION. 🤯", state: "published", when: -12 },
  { slug: "nokia", title: "Nokia had the iPhone first", kicker: "Fallen giants", colors: ["#6aa8ff", "#2747c9", "#0b1240"], dur: 58, story: "Nokia built a touchscreen phone years before Apple and buried it.", hook: "Nokia built the iPhone first.\nThen they killed it.", state: "published", when: -24 },
  { slug: "starbucks", title: "The $5 coffee empire", kicker: "Brand breakdown", colors: ["#7dd8a8", "#16805a", "#06261c"], dur: 39, story: "How Starbucks sells a feeling, not coffee, and why the third place idea worked.", hook: "You're not paying $5 for coffee.", state: "published", when: -5 },
  { slug: "zomato", title: "The 10-minute pivot", kicker: "India inc.", colors: ["#ff7a7a", "#c81d3a", "#3a0612"], dur: 52, story: "Zomato's bet on 10-minute delivery and what it cost them.", hook: "10 minutes. That promise nearly broke Zomato.", state: "scheduled", when: 2 },
  { slug: "tata-nano", title: "The car nobody wanted", kicker: "Case study", colors: ["#ffd36b", "#e0861b", "#3d2003"], dur: 61, story: "Tata Nano was the cheapest car in the world and that was exactly the problem.", hook: "The cheapest car in the world.\nThat was the mistake.", state: "scheduled", when: 4 },
  { slug: "dyson", title: "5,127 failed prototypes", kicker: "Founder grit", colors: ["#c9a2ff", "#7036d8", "#1d0b45"], dur: 44, story: "James Dyson built 5,127 prototypes before the vacuum that made him a billionaire.", hook: "5,126 failures. Then one billion-dollar vacuum.", state: "scheduled", when: 6 },
  { slug: "blockbuster", title: "They laughed at Netflix", kicker: "Fallen giants", colors: ["#7fe0ff", "#1f8fb8", "#062a3a"], dur: 55, story: "Blockbuster had the chance to buy Netflix for $50 million and laughed them out of the room.", hook: "", state: "draft", when: 0 },
  { slug: "oyo", title: "Room by room", kicker: "Startup stories", colors: ["#ff9ec7", "#d63384", "#3d0a24"], dur: 49, story: "How OYO scaled from one hotel to thousands, and the cracks it hid.", hook: "From one hotel to 40,000 rooms. Too fast?", state: "partial", when: -1 },
] as const;

async function main() {
  const storage = resolve(process.cwd(), "storage");
  await db.user.deleteMany({ where: { email: "creator@studio.dev" } });
  const user = await db.user.create({
    data: { name: "Maya Rao", email: "creator@studio.dev", passwordHash: await bcrypt.hash("studio123", 11), timezone: "Asia/Kolkata" },
  });

  if (process.env.SEED_SAMPLES !== "1") {
    console.log(`Seeded ${user.email} (password: studio123) with no accounts. Connect your own on /accounts.`);
    return;
  }

  const accounts = {
    instagram: await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: "mock-instagram-001", username: "@maya.makes", displayName: "Maya Makes", accessToken: enc("mock_access_instagram"), refreshToken: enc("mock_refresh_instagram"), tokenExpiresAt: new Date(Date.now() + 50 * DAY) } }),
    youtube: await db.socialAccount.create({ data: { userId: user.id, platform: "youtube", platformUserId: "mock-youtube-001", username: "Maya Makes Things", displayName: "Maya Makes Things", accessToken: enc("mock_access_youtube"), refreshToken: enc("mock_refresh_youtube"), tokenExpiresAt: new Date(Date.now() + 50 * DAY) } }),
    x: await db.socialAccount.create({ data: { userId: user.id, platform: "x", platformUserId: "mock-x-001", username: "@mayamakes", displayName: "Maya", accessToken: enc("mock_access_x"), refreshToken: enc("mock_refresh_x"), tokenExpiresAt: new Date(Date.now() + 50 * DAY) } }),
  };

  // Sample posters are public, non-user art: serve them from /public so they work with any storage driver.
  const samplesDir = resolve(storage, "..", "public", "samples");
  mkdirSync(samplesDir, { recursive: true });
  let i = 0;
  for (const s of SAMPLES) {
    const thumbKey = `/samples/${s.slug}.svg`;
    writeFileSync(resolve(samplesDir, `${s.slug}.svg`), poster(s.title, s.kicker, s.colors[0], s.colors[1], s.colors[2]));
    const media = await db.media.create({
      data: { userId: user.id, originalFilename: `${s.slug}-final.mp4`, storageKey: `sample/${s.slug}.mp4`, thumbnailKey: thumbKey, mimeType: "video/mp4", size: 18_000_000 + i * 3_100_000, duration: s.dur, width: 1080, height: 1920, status: "ready", createdAt: new Date(now.getTime() + (s.when - 2) * DAY) },
    });
    const sub = s.title;
    const scheduledAt = s.state === "scheduled" ? at(s.when, [20, 18, 19][i % 3], 0) : null;
    const publishedAt = s.state === "published" || s.state === "partial" ? at(s.when, 19, 30) : null;
    const post = await db.post.create({
      data: { userId: user.id, mediaId: media.id, title: sub, story: s.story, hook: s.hook || null, status: s.state, scheduledAt, publishedAt: s.state === "published" ? publishedAt : null, createdAt: media.createdAt },
    });
    const plats = s.state === "draft" ? (["instagram", "youtube"] as const) : (["instagram", "youtube", "x"] as const);
    for (const p of plats) {
      const failed = s.state === "partial" && p === "instagram";
      const published = s.state === "published" || (s.state === "partial" && !failed);
      const pid = `${s.slug}-${p}`;
      const t = await db.postTarget.create({
        data: {
          postId: post.id,
          socialAccountId: accounts[p].id,
          platform: p,
          title: p === "youtube" ? `${sub} (The Story Nobody Tells) #Shorts` : null,
          caption: p === "instagram" ? `${s.hook.replace(/\n/g, " ")}\n\n${s.story}\n\nWould you have made the same call? 👇` : p === "x" ? `${s.hook.split("\n")[0]}\n\nThe whole story in ${s.dur} seconds ↓` : null,
          description: p === "youtube" ? `${s.story}\n\nSubscribe for a new story every week.` : null,
          hashtags: p === "instagram" ? "#startupstory #businesstips #reelsdaily #entrepreneur" : p === "youtube" ? "#Shorts #business" : null,
          platformStatus: failed ? "failed" : published ? "published" : "pending",
          platformPostId: published ? pid : null,
          platformUrl: null, // seeded posts are practice data: no real link exists
          practice: true,
          errorCode: failed ? "AUTH_EXPIRED" : null,
          errorMessage: failed ? 'HTTP 401 Unauthorized\n{"error":{"message":"Error validating access token: Session has expired.","type":"OAuthException","code":190}}' : null,
          publishedAt: published ? publishedAt : null,
        },
      });
      if (published && publishedAt) {
        const scale = { instagram: 1, youtube: 1.35, x: 0.32 }[p] * [1.6, 0.9, 1.15, 1, 1, 1, 1, 0.7][i];
        const metrics = [];
        const start = Math.max(publishedAt.getTime(), now.getTime() - 45 * DAY);
        for (let d = start, k = Math.round((start - publishedAt.getTime()) / DAY); d <= now.getTime(); d += DAY, k++) {
          const views = Math.round(9000 * scale * Math.exp(-k / 5) + 380 * scale * (1 + Math.sin(k)) + Math.random() * 240 * scale);
          metrics.push({ targetId: t.id, capturedAt: new Date(d), views, likes: Math.round(views * (0.061 + Math.random() * 0.02)), comments: Math.round(views * 0.0042), shares: Math.round(views * (0.009 + Math.random() * 0.004)) });
        }
        await db.targetMetric.createMany({ data: metrics });
      }
    }
    i++;
  }
  console.log(`Seeded ${SAMPLES.length} posts for ${user.email} (password: studio123)`);
}

main().finally(() => db.$disconnect());
