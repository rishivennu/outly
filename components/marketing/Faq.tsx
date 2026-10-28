import { Shell, SectionHead } from "./bits";
import Link from "next/link";
import { FAQS } from "@/lib/marketing/content";
import { LiquidAccordion } from "@/components/support/LiquidAccordion";

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="faq-title">
      <Shell className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div>
          <SectionHead
            id="faq-title"
            eyebrow="Straight answers"
            title="The things we would want asked."
            body="Publishing on someone else's platform comes with their rules attached. Here are the ones that will affect you."
          />
          <Link href="/help" className="mt-6 inline-flex h-11 items-center rounded-full px-5 text-sm font-medium hairline transition-colors hover:bg-secondary">Search the help centre</Link>
        </div>
        {/* the first answer is open so the section reads as prose, not a wall of plus signs; questions rise in turn */}
        <LiquidAccordion reveal items={FAQS.map((f, i) => ({ id: `m${i}`, q: f.q, a: f.a }))} defaultOpen={["m0"]} />
      </Shell>
    </section>
  );
}
