import { Shell, SectionHead } from "./bits";
import { TrustLive } from "./TrustLive";
import { Reveal } from "./Reveal";
import { trustCounts } from "@/lib/marketing/trust-stats";
import { floorNice } from "@/lib/marketing/trust-core";

/**
 * Trust (1048 redesign, "the receipt"): a till receipt printed live, with the real counts at the top and every
 * safeguard as a line item, beside three big zeros. Each line is something the code does today
 * (lib/crypto.ts, Settings > Two-step, Settings > Your data, the gateways). No logos, quotes or ratings.
 */
export async function Trust() {
  const c = await trustCounts().catch(() => ({ creators: 0, posts: 0, platforms: 0 }));
  const posts = c.posts > 0 ? `${floorNice(c.posts).toLocaleString("en-US")}${c.posts >= 10 ? "+" : ""}` : null;
  return (
    <section id="trust" className="scroll-mt-24 overflow-hidden py-16 sm:py-20" aria-labelledby="trust-title">
      <Shell>
        <SectionHead id="trust-title" eyebrow="Trust" title="Your accounts, kept safe." body="Here's the receipt: the real numbers, and what Outlly does with the keys to your channels." />
        {/* The printer rises into place through its mask; the receipt then prints on its own (TrustLive). */}
        <Reveal>
          <TrustLive creators={c.creators} posts={posts} platforms={c.platforms} />
        </Reveal>
      </Shell>
    </section>
  );
}
