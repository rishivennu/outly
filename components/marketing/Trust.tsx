import { KeyRound, LockKeyhole, Plug, Download, CreditCard } from "lucide-react";
import { Shell, SectionHead } from "./bits";
import { Reveal } from "./Reveal";
import { trustStats } from "@/lib/marketing/trust-stats";

/** Each line is something the code does today (lib/crypto.ts, Settings > Two-step, Settings > Your data, the gateways). */
const FACTS = [
  { Ico: LockKeyhole, title: "Sign-ins encrypted", body: "Your Instagram, YouTube and X access is stored encrypted with AES-256-GCM, never in plain text." },
  { Ico: KeyRound, title: "Two-step sign-in", body: "Add a one-time code to your Outlly login from Settings, on every plan." },
  { Ico: Plug, title: "Official APIs only", body: "Outlly posts through each platform's own API. No password sharing, no browser bots." },
  { Ico: Download, title: "Your data, your call", body: "Export everything or delete your account yourself, any time, from Settings." },
  { Ico: CreditCard, title: "We never see your card", body: "Payments run through the payment gateway's own checkout. Outlly stores no card numbers." },
];

/**
 * Trust (1037): real figures from the database, each hidden until it is big enough to mean something
 * (lib/marketing/trust-core.ts), and the safety facts behind them. No logos, quotes or ratings we don't have.
 */
export async function Trust() {
  const figures = await trustStats().catch(() => []);
  // Columns follow how many figures cleared their floor, so a young site never shows an empty grey cell.
  const cols = ["", "", "sm:grid-cols-2", "sm:grid-cols-3"][figures.length] ?? "sm:grid-cols-3";
  return (
    <section id="trust" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="trust-title">
      <Shell>
        <SectionHead id="trust-title" eyebrow="Trust" title="Your accounts, kept safe." body="What Outlly does with the keys to your channels, in plain words." />
        {figures.length > 0 && (
          <Reveal as="ul" className={`mt-10 grid gap-px overflow-hidden rounded-[1.75rem] border border-border bg-border ${cols} ${figures.length === 1 ? "sm:max-w-sm" : ""}`}>
            {figures.map((f) => (
              <li key={f.label} className="bg-background p-6 sm:p-8">
                <p className="display text-[clamp(2.2rem,5vw,3.2rem)] leading-none tabular">{f.value}</p>
                <p className="mt-2 text-[15px] text-muted-foreground">{f.label}</p>
              </li>
            ))}
          </Reveal>
        )}
        <Reveal as="ul" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {FACTS.map(({ Ico, title, body }) => (
            <li key={title} className="flex flex-col gap-3 rounded-[1.5rem] p-5 hairline">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--lime)/0.18)]" aria-hidden="true">
                <Ico className="h-5 w-5" />
              </span>
              <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </Reveal>
      </Shell>
    </section>
  );
}
