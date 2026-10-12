import type { Metadata } from "next";
import { PageHead, Prose, Shell } from "@/components/marketing/bits";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Outlly stores, where your uploaded video lives, which third parties see it, and how to get it deleted.",
  alternates: { canonical: "/privacy" },
  openGraph: { title: "Privacy · Outlly", description: "What Outlly stores and why.", url: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead
          title="Privacy"
          updated="10 October 2026"
          lead="Outlly is in beta. This page describes what the product actually does with your data today, in plain language. If something here changes, the date above changes with it."
        />

        <Prose>
          <h2>What we store</h2>
          <ul>
            <li><strong>Your account</strong> — email address and a hashed password. Nothing else is required to sign up.</li>
            <li><strong>Media you upload</strong> — the video file itself, plus technical details we read from it such as duration, resolution and aspect ratio.</li>
            <li><strong>The posts you create</strong> — captions, hooks, hashtags, titles, schedules, and the status each destination reported back.</li>
            <li><strong>Connected accounts</strong> — the access tokens each platform issues, encrypted at rest, plus the account name and avatar the platform returns so you can tell your accounts apart.</li>
            <li><strong>Operational logs</strong> — publish attempts, errors and timings, so a failed post can be explained to you.</li>
          </ul>

          <h2>Where uploads live</h2>
          <p>
            Uploaded files go to private object storage attached to your account. Buckets are not publicly listable, and playback inside Outlly
            uses short-lived signed links that expire. When you delete a media item, the stored file is deleted with it.
          </p>
          <p>We do not use your footage, captions or analytics to train models, and we do not sell any of it.</p>

          <h2>AI generation</h2>
          <p>
            When you ask for a caption, hook, hashtag set or title, the text prompt describing your video is sent to a third-party language
            model provider to generate the draft. Your video file is not uploaded to the model provider. Generated text is stored with your
            post so you can see what was suggested and what you changed.
          </p>

          <h2>Third parties that necessarily see your content</h2>
          <ul>
            <li><strong>Meta</strong> — when you publish an Instagram Reel, through the Instagram Content Publishing API.</li>
            <li><strong>Google</strong> — when you publish a YouTube Short, through the YouTube Data API.</li>
            <li><strong>X</strong> — when you post to X, through the X API.</li>
          </ul>
          <p>
            Each of those platforms applies its own privacy policy to whatever you publish there. Once a post is live on a platform, that
            platform&apos;s terms govern it, and deleting it in Outlly does not delete it there.
          </p>

          <h2>Cookies</h2>
          <p>
            One cookie keeps you signed in. Your light or dark theme choice is stored in your browser, not on our servers. There is no
            advertising or cross-site tracking on this site.
          </p>

          <h2>Deletion and export</h2>
          <p>
            You can delete any media item or post from the content library at any time. Deleting your account removes your media, posts and
            stored platform tokens. Operational logs that no longer identify you may be retained for a short period for debugging. Your source
            files stay downloadable from the library for as long as the account exists, so nothing you upload is locked in.
          </p>

          <h2>Changes while we are in beta</h2>
          <p>
            Beta means this is a moving product. If we start storing something new, or send data somewhere new, this page is updated and the
            date at the top moves. Material changes to how your content is handled will be announced in the app, not only here.
          </p>

          <h2>Asking us something</h2>
          <p>
            Questions about any of this, including a deletion request you cannot complete yourself, go through the{" "}
            <a href="/contact">contact page</a>.
          </p>
        </Prose>
      </Shell>
    </section>
  );
}
