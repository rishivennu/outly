import { DemoFlow } from "./DemoFlow";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";

export function Demo() {
  return (
    <section id="demo" className="ap-canvas scroll-mt-24 overflow-hidden py-20 sm:py-28" aria-labelledby="demo-title">
      <Shell>
        <SectionHead
          id="demo-title"
          align="center"
          eyebrow="The flow, end to end"
          title="Watch one upload become three posts."
          body="Including the part where a platform says no. Step through it yourself with the buttons underneath."
        />
        <Reveal className="mt-12 sm:mt-16">
          <DemoFlow />
        </Reveal>
      </Shell>
    </section>
  );
}
