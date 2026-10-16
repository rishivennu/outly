import "server-only";
import { FEATURES, HERO, PLANS, PLATFORM_PITCH, PRICING_NOTE } from "../marketing/content";
import { PLATFORMS, PLATFORM_META } from "../domain";
import { liveNow } from "../social/registry";

/**
 * Everything Pip may state as an Outlly fact, besides the FAQ: built from the same copy the site shows,
 * so the bot and the landing page can never disagree. Live platforms follow the admin's keys.
 */
export async function productBrief() {
  const live = await liveNow().catch(() => [] as string[]);
  const soon = PLATFORMS.filter((p) => !live.includes(p)).map((p) => PLATFORM_META[p].name);
  return [
    `Outlly: ${HERO.sub}`,
    `Live platforms right now: ${live.map((p) => PLATFORM_META[p as keyof typeof PLATFORM_META].name).join(", ") || "none yet"}. Not live yet (switch on once the platform approves our app): ${soon.join(", ") || "none"}.`,
    `Features:\n${FEATURES.map((f) => `- ${f.title}: ${f.body}`).join("\n")}`,
    `Platforms:\n${PLATFORM_PITCH.map((p) => `- ${p.name} (${p.format}): ${p.blurb} Needs: ${p.needs} Specs: ${p.specs.join("; ")}`).join("\n")}`,
    `Pricing: ${PRICING_NOTE}\n${PLANS.map((p) => `- ${p.name} (${p.state}, ${p.price}): ${p.note} ${p.bullets.join("; ")}`).join("\n")}`,
    `Where things are in the studio: Home (overview and setup checklist), Create (upload a video, AI hooks, captions and titles per platform, publish or schedule), Calendar (scheduled posts), Content (every post and its per-platform status, retry failed ones), Analytics, Inbox (comments with AI reply suggestions), Accounts (connect or reconnect Instagram, YouTube, X), Billing (plan, invoices, cancel), Settings (profile, time zone, team, Your data: download my data, sign out everywhere, delete account), Support (help centre and your requests).`,
  ].join("\n\n");
}
