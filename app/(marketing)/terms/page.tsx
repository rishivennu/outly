import type { Metadata } from "next";
import { PageHead, Prose, Shell } from "@/components/marketing/bits";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms of using Outlly during beta: what you keep, what we are responsible for, and what depends on Instagram, YouTube and X.",
  alternates: { canonical: "/terms" },
  openGraph: { title: "Terms · Outlly", description: "The terms of using Outlly during beta.", url: "/terms" },
};

export default function TermsPage() {
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead
          title="Terms"
          updated="10 October 2026"
          lead="Short, specific, and written for a beta product. Using Outlly means these apply to you."
        />

        <Prose>
          <h2>Beta software</h2>
          <p>
            Outlly is in beta and provided as it is. Features move, limits change, and downtime happens. Do not make Outlly the only copy of
            anything you care about — keep your source files on your own machine or drive as well.
          </p>

          <h2>Your content stays yours</h2>
          <p>
            You keep ownership of everything you upload and everything you publish. You grant us only the permission needed to run the
            product: to store your file, transcode or inspect it where that is required, generate drafts you asked for, and transmit the post
            to the platforms you chose.
          </p>

          <h2>What you are responsible for</h2>
          <ul>
            <li>Having the rights to the video, audio, music and likenesses in what you upload.</li>
            <li>Following each platform&apos;s own rules. Instagram, YouTube and X can reject, limit or remove a post for reasons we have no visibility into.</li>
            <li>Keeping your account secure, and the content published through any platform account you connect.</li>
            <li>Not using Outlly for spam, bulk impersonation, or automated posting that breaches a platform&apos;s developer terms.</li>
          </ul>

          <h2>What we are responsible for</h2>
          <p>
            Running the service with reasonable care, keeping your uploads private, telling you honestly when a publish fails, and not using
            your content for anything you did not ask for. We are not responsible for a platform rejecting your post, changing its API,
            suspending your account there, or for reach and performance of anything you publish.
          </p>

          <h2>Platform dependencies</h2>
          <p>
            Publishing works through official platform APIs, and every one of them has conditions outside our control: a professional
            Instagram account, Google OAuth consent for YouTube uploads, and an X developer app on a tier that allows media posting. Access
            tiers, rate limits and review decisions belong to those platforms. If one of them withdraws access, that destination stops
            working until it is restored.
          </p>

          <h2>Price</h2>
          <p>
            Outlly is free during beta. There are no paid plans on sale. If that changes, you will see the price and the terms before anything
            is charged, and a beta account will never be billed without an explicit opt-in.
          </p>

          <h2>Ending it</h2>
          <p>
            You can delete your account whenever you like, and your media and posts go with it. We may suspend an account that is breaking
            these terms or a platform&apos;s developer terms, and we will say why where we are allowed to.
          </p>

          <h2>Changes</h2>
          <p>
            These terms will change as the product leaves beta. The date at the top tells you when they last did, and material changes are
            announced in the app.
          </p>

          <h2>Questions</h2>
          <p>
            Anything unclear here is worth asking about — use the <a href="/contact">contact page</a>.
          </p>
        </Prose>
      </Shell>
    </section>
  );
}
