import { KeyRound, LockKeyhole, Plug, Download, CreditCard } from "lucide-react";
import { Shell, SectionHead } from "./bits";
import { Reveal } from "./Reveal";
import { TrustLive } from "./TrustLive";
import { trustCounts } from "@/lib/marketing/trust-stats";
import { floorNice } from "@/lib/marketing/trust-core";

/** Each line is something the code does today (lib/crypto.ts, Settings > Two-step, Settings > Your data, the gateways). */
const FACTS = [
  { Ico: LockKeyhole, title: "Sign-ins encrypted", body: "Instagram, YouTube and X access is stored with AES-256-GCM, never in plain text." },
  { Ico: KeyRound, title: "Two-step sign-in", body: "Add a one-time code to your login from Settings, on every plan." },
  { Ico: Plug, title: "Official APIs only", body: "Posts go through each platform's own API. No password sharing, no bots." },
  { Ico: Download, title: "Your data, your call", body: "Export everything or delete your account yourself, any time." },
  { Ico: CreditCard, title: "We never see your card", body: "Payments run in the gateway's own checkout. No card numbers stored." },
];

/**
 * Trust (1038 redesign): a live panel of real counts beside a compact list of how accounts are kept safe.
 * No logos, quotes or ratings we don't have.
 */
export async function Trust() {
  const c = await trustCounts().catch(() => ({ creators: 0, posts: 0, platforms: 0 }));
  const posts = c.posts > 0 ? `${floorNice(c.posts).toLocaleString("en-US")}${c.posts >= 10 ? "+" : ""}` : null;
  return (
    <section id="trust" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="trust-title">
      <Shell>
        <SectionHead id="trust-title" eyebrow="Trust" title="Your accounts, kept safe." body="Real numbers, and what Outlly does with the keys to your channels, in plain words." />
        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Reveal y={36} className="h-full">
            <TrustLive creators={c.creators} posts={posts} platforms={c.platforms} />
          </Reveal>
          <Reveal as="ul" stagger y={20} delay={0.1} className="divide-y divide-border rounded-[2rem] px-5 hairline sm:px-7">
            {FACTS.map(({ Ico, title, body }) => (
              <li key={title} className="flex items-start gap-4 py-4 sm:py-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--lime)/0.2)]" aria-hidden="true">
                  <Ico className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15.5px] font-semibold tracking-tight">{title}</h3>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </Reveal>
        </div>
      </Shell>
    </section>
  );
}
