import { Plus } from "lucide-react";
import { Shell, SectionHead } from "./bits";
import { Reveal } from "./Reveal";
import { FAQS } from "@/lib/marketing/content";

/** <details> so the FAQ needs no JavaScript and stays keyboard-native. */
export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="faq-title">
      <Shell className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <SectionHead
          id="faq-title"
          eyebrow="Straight answers"
          title="The things we would want asked."
          body="Publishing on someone else's platform comes with their rules attached. Here are the ones that will affect you."
        />
        <Reveal stagger className="border-t border-border">
          {FAQS.map((f, i) => (
            // the first answer is open so the section reads as prose, not a wall of plus signs
            <details key={f.q} open={i === 0} className="group border-b border-border">
              <summary className="flex cursor-pointer list-none items-start gap-4 py-5 text-[17px] font-medium tracking-tight [&::-webkit-details-marker]:hidden">
                <span className="flex-1 text-pretty">{f.q}</span>
                <Plus
                  className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-45"
                  aria-hidden="true"
                />
              </summary>
              <p className="max-w-prose pb-6 pr-9 text-[15px] leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </Reveal>
      </Shell>
    </section>
  );
}
