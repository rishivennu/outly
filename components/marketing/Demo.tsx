import { DemoFlow } from "./DemoFlow";
import { Shell } from "./bits";

/** "Watch one upload become three posts": the phone flow as a brand bento. Its heading lives inside DemoFlow's stage. */
export function Demo() {
  return (
    <section id="demo" className="scroll-mt-24 overflow-hidden py-16 sm:py-20" aria-labelledby="demo-title">
      <Shell>
        <DemoFlow />
      </Shell>
    </section>
  );
}
