import { Shell, SectionHead } from "./bits";
import { TryItStage } from "./TryItStage";

/**
 * "Try it" (10-28): type one line, watch Outlly write the Instagram caption, the Shorts title and the X post.
 * Typed lines go to /api/try (lib/try.ts: the studio's hook + caption engine, rate-limited per IP and per day).
 * "Keep these drafts" carries the topic through sign-up into /create?text=.
 */
export function TryIt() {
  return (
    <section id="try" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="try-title">
      <Shell>
        <SectionHead
          id="try-title"
          eyebrow="Try it"
          title="One line in. Three posts out."
          body="Say what your video is about. See what Outlly writes for each place before you make an account."
        />
        <TryItStage />
      </Shell>
    </section>
  );
}
