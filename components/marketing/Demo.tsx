import { DemoFlow } from "./DemoFlow";
import { Shell, SectionHead } from "./bits";

export function Demo() {
  return (
    <section id="demo" className="ap-canvas scroll-mt-24 overflow-hidden py-16 sm:py-24" aria-labelledby="demo-title">
      <Shell>
        <DemoFlow
          head={
            <SectionHead
              id="demo-title"
              eyebrow="The flow, end to end"
              title={<>Watch one upload become <span className="dm-hl">three posts.</span></>}
              body="Including the part where a platform says no."
              className="dm-head"
            />
          }
        />
      </Shell>
    </section>
  );
}
