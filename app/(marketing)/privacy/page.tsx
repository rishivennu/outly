import type { Metadata } from "next";
import { PageHead, Prose, Shell } from "@/components/marketing/bits";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Outlly stores, what each connected platform (Instagram, YouTube, X, TikTok, Threads, Facebook, LinkedIn) lets us do, who processes your data, and how to get it deleted.",
  alternates: { canonical: "/privacy" },
  openGraph: { title: "Privacy · Outlly", description: "What Outlly stores, why, and how to remove it.", url: "/privacy" },
};

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

/** One entry per platform Outlly connects to: what we ask for, in plain words, and where to revoke it. */
const PLATFORMS: { name: string; api: string; asks: string[]; uses: string; policy: { label: string; href: string }[] }[] = [
  {
    name: "Instagram",
    api: "Instagram API with Instagram Login (Meta)",
    asks: ["Your professional account’s basic profile (username, name, profile picture)", "Publishing Reels to that account", "Reading and replying to comments on your posts", "Reading and answering direct messages sent to that account"],
    uses: "We publish the Reels you schedule, show their status and numbers, and bring comments and direct messages into your Inbox. You can answer a message for 24 hours after the person last wrote, as Meta requires. Instagram fetches the video from a private link that expires.",
    policy: [{ label: "Instagram Terms of Use", href: "https://help.instagram.com/581066165581870" }, { label: "Meta Privacy Policy", href: "https://www.facebook.com/privacy/policy" }],
  },
  {
    name: "YouTube",
    api: "YouTube Data API v3 and YouTube Analytics API (Google)",
    asks: ["Uploading videos to your channel", "Reading your channel and video details", "Reading and replying to comments", "Reading your channel analytics (views, watch time, subscribers)", "If you sign in with Google: your name, email address and profile picture"],
    uses: "We upload the Shorts you schedule, check their processing status, show your channel and video numbers, and bring comments into your Inbox.",
    policy: [{ label: "YouTube Terms of Service", href: "https://www.youtube.com/t/terms" }, { label: "Google Privacy Policy", href: "https://policies.google.com/privacy" }],
  },
  {
    name: "X",
    api: "X API v2",
    asks: ["Reading your profile and posts", "Posting and uploading media for you", "Staying connected without signing in again (offline access)"],
    uses: "We publish the posts you schedule, show their numbers, and bring replies into your Inbox.",
    policy: [{ label: "X Terms of Service", href: "https://x.com/tos" }, { label: "X Privacy Policy", href: "https://x.com/privacy" }],
  },
  {
    name: "TikTok",
    api: "TikTok Login Kit and Content Posting API",
    asks: ["Your basic profile (display name, avatar, profile details)", "Uploading videos and publishing them to your account"],
    uses: "We send the videos you schedule to TikTok with the privacy setting you choose. Until TikTok approves our app, posts can only be published privately.",
    policy: [{ label: "TikTok Terms of Service", href: "https://www.tiktok.com/legal/page/global/terms-of-service/en" }, { label: "TikTok Privacy Policy", href: "https://www.tiktok.com/legal/page/global/privacy-policy/en" }],
  },
  {
    name: "Threads",
    api: "Threads API (Meta)",
    asks: ["Your basic Threads profile", "Publishing posts to Threads", "Reading and replying to replies on your threads"],
    uses: "We publish the posts you schedule and show their status. Threads fetches the video from a private link that expires.",
    policy: [{ label: "Meta Privacy Policy", href: "https://www.facebook.com/privacy/policy" }],
  },
  {
    name: "Facebook",
    api: "Facebook Pages API (Meta)",
    asks: ["The list of Pages you manage", "Reading engagement on those Pages", "Publishing posts and videos to a Page", "Reading and answering Messenger messages sent to that Page, and subscribing the Page to message notifications"],
    uses: "We publish Reels to the first Page you manage and show their status, and bring the Page’s Messenger conversations into your Inbox so you can answer them within Meta’s 24-hour window. Facebook fetches the video from a private link that expires.",
    policy: [{ label: "Meta Terms", href: "https://www.facebook.com/terms.php" }, { label: "Meta Privacy Policy", href: "https://www.facebook.com/privacy/policy" }],
  },
  {
    name: "LinkedIn",
    api: "Sign In with LinkedIn using OpenID Connect and Share on LinkedIn",
    asks: ["Your name, profile picture and email address", "Posting to your LinkedIn profile"],
    uses: "We publish the posts you schedule to your own profile and show their status.",
    policy: [{ label: "LinkedIn User Agreement", href: "https://www.linkedin.com/legal/user-agreement" }, { label: "LinkedIn Privacy Policy", href: "https://www.linkedin.com/legal/privacy-policy" }],
  },
];

export default function PrivacyPage() {
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead
          title="Privacy"
          updated="18 October 2026"
          lead="This page describes what Outlly actually does with your data today, in plain language, including exactly what each social platform lets us do once you connect it. If anything here changes, the date above changes with it."
        />

        <Prose>
          <h2>The short version</h2>
          <ul>
            <li>We only post when you tell us to: publishing now, or a schedule you set.</li>
            <li>Platform access tokens are encrypted, never shown to your browser, and deleted when you disconnect.</li>
            <li>We do not sell your data, show ads, or use your videos, captions, comments or numbers to train AI models.</li>
            <li>You can disconnect any platform at any time, and delete your whole account yourself from Settings.</li>
          </ul>

          <h2>What we store</h2>
          <ul>
            <li><strong>Your account:</strong> name, email address, time zone, your avatar choice, and either a hashed password or the identity Google returns when you sign in with Google. We also note which days you were active, so streaks, weekly reports and support work.</li>
            <li><strong>Media you upload:</strong> the video file, a poster frame, and technical details such as duration, resolution and aspect ratio. If you ask for captions from speech, the transcript is stored with the post.</li>
            <li><strong>The posts you create:</strong> captions, hooks, titles, hashtags, schedules, approval requests, and the status each platform reported back.</li>
            <li><strong>Connected accounts:</strong> the access and refresh tokens each platform issues (encrypted with AES-256-GCM), when they expire, and the account ID, username, display name and avatar the platform returns.</li>
            <li><strong>Numbers and comments from your accounts:</strong> views, likes, comments, followers and similar figures for your posts, and the comments in your Inbox. Live figures are cached for about a minute and a half; per-post history is kept so your analytics can show trends.</li>
            <li><strong>Billing:</strong> your plan, payment amounts, status and the gateway reference, and invoices with your name and email. Card and bank details go straight to the payment provider. We never see or store them. If you pay by UPI through YOUPI, we send it only the amount and an order number, never your name, email or phone.</li>
            <li><strong>Teams:</strong> if you invite people to your studio, their email address, name and role.</li>
            <li><strong>Support:</strong> what you write to Pip, our support assistant, and any ticket you open, including the conversation that led to it, so a person can pick it up.</li>
            <li><strong>Operational logs:</strong> publish attempts, errors, timings and the emails we sent you, so a failed post or a missing email can be explained.</li>
          </ul>

          <h2>What each platform lets us do</h2>
          <p>
            You connect each platform yourself through its own sign-in screen. We never see your password for any of them, and we only ask
            for what the features below need. Only the owner of a studio can connect or disconnect accounts; teammates cannot.
          </p>
          {PLATFORMS.map((p) => (
            <div key={p.name}>
              <h3>{p.name}</h3>
              <p className="!mb-2">Through the {p.api}, we ask permission for:</p>
              <ul>
                {p.asks.map((a) => <li key={a}>{a}</li>)}
              </ul>
              <p>
                {p.uses} {p.name.endsWith("s") ? `${p.name}’` : `${p.name}’s`} own terms apply to what you publish there:{" "}
                {p.policy.map((l, i) => (
                  <span key={l.href}>
                    {i > 0 && " and "}
                    <a href={l.href} {...ext}>{l.label}</a>
                  </span>
                ))}
                .
              </p>
            </div>
          ))}
          <p>
            Once a post is live on a platform, that platform holds its own copy under its own terms. Deleting a post in Outlly does not delete
            it there.
          </p>

          <h3>Google user data</h3>
          <p>
            Outlly’s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" {...ext}>Google API Services User Data Policy</a>, including
            the Limited Use requirements. We use YouTube and Google sign-in data only to provide the features you see in Outlly. We do not
            sell it, use it for advertising, let people read it except where you ask for support or the law requires it, or use it to train
            AI models. You can remove Outlly’s access at any time from your{" "}
            <a href="https://myaccount.google.com/permissions" {...ext}>Google Account permissions</a>.
          </p>

          <h2>Where uploads live</h2>
          <p>
            Uploaded files go to private object storage tied to your account. Nothing is publicly listed. Playback inside Outlly, and the copy
            Instagram, Threads or Facebook fetch when they publish, use signed links that expire after a short time. When you delete a media
            item, the stored file is deleted with it.
          </p>

          <h2>AI features</h2>
          <p>Outlly uses Google Gemini for its AI features. Here is exactly what is sent, and only when you use that feature:</p>
          <ul>
            <li><strong>Captions, hooks, titles and hashtags:</strong> the text you write describing your video.</li>
            <li><strong>Captions from speech:</strong> the audio track of your video, converted to a small sound file. The video picture is not sent. If we switch on our own speech-recognition server (FunASR), the sound file goes there instead of Google.</li>
            <li><strong>Clip highlights:</strong> the subtitle text of your video, so it can suggest the moments worth their own clip.</li>
            <li><strong>Reply suggestions:</strong> the comment or direct message you are replying to, and the sender’s display name.</li>
            <li><strong>Insights on your analytics:</strong> your account and post numbers.</li>
            <li><strong>Pip, the support assistant:</strong> your question and the last few messages of the chat.</li>
          </ul>
          <p>
            AI suggestions are drafts. Nothing generated is published until you choose to publish it. Our team also uses Gemini, without training any model on it, on anonymised,
            aggregated product numbers (no names or email addresses) to understand how Outlly is used.
          </p>

          <h2>Who processes your data for us</h2>
          <ul>
            <li><strong>Vercel:</strong> hosts the website and app.</li>
            <li><strong>Supabase:</strong> our database, sign-in and file storage.</li>
            <li><strong>Cloudflare (R2):</strong> may store your uploaded videos and thumbnails instead of, or as a copy of, Supabase storage.</li>
            <li><strong>Upstash:</strong> shared rate-limit counters that stop abuse. They are keyed by a scrambled form of your IP address, never the address itself, and expire within minutes.</li>
            <li><strong>Resend:</strong> sends account, publishing, invoice and support emails.</li>
            <li><strong>Stripe, Razorpay or PayPal:</strong> takes payments, depending on which you choose at checkout.</li>
            <li><strong>YOUPI (UPI payments):</strong> a payment gateway we run on our own server. It confirms a UPI payment by matching it with our bank&rsquo;s payment alert, so it sees the amount, time, UPI reference and any payer name or UPI ID the alert shows.</li>
            <li><strong>Google (Gemini API):</strong> the AI features above.</li>
            <li><strong>The social platforms you connect:</strong> as described above.</li>
          </ul>
          <p>Each one only receives what it needs to do that job. Some are outside India, so your data may be processed in other countries under their safeguards.</p>

          <h2>Cookies and browser storage</h2>
          <ul>
            <li><strong>Sign-in</strong> (<code>studio_session</code>): keeps you signed in.</li>
            <li><strong>Workspace</strong> (<code>ol_ws</code>): remembers which studio you are working in if you belong to a team.</li>
            <li><strong>Connecting a platform:</strong> a short-lived, encrypted cookie that protects the sign-in round trip. It expires after 10 minutes.</li>
            <li><strong>Preferences:</strong> your currency (<code>ol_ccy</code>), practice mode (<code>studio_sim</code>), theme, language and your cookie choice (<code>outly-consent</code>).</li>
            <li><strong>Referrals</strong> (<code>ol_ref</code>): if a friend invited you, so both of you get the free month.</li>
            <li><strong>Pip chat:</strong> your current conversation is kept in this browser tab only, and cleared when the tab closes.</li>
          </ul>
          <p>
            There is no advertising or cross-site tracking. The cookie banner lets you allow or refuse analytics and marketing cookies; today
            we do not run any, and if we add them they will only load after you allow them.
          </p>

          <h2>Direct messages</h2>
          <p>
            When you connect Instagram or a Facebook Page, Meta sends Outlly the direct messages people write to that account, and the replies you send, so they appear in your Inbox. We store the text encrypted, together with the sender&rsquo;s display name, username, profile picture link and the time. Photos and videos stay with Meta: we keep only the link Meta gives us. Messages are used only to show your conversations and send your replies. They are never used for advertising, never sold, and never used to train AI. Only you and the teammates you invite to your workspace can read them; editors can read but not reply.
          </p>
          <p>
            Messages are deleted automatically 180 days after they were sent. Disconnecting the account, removing Outlly in Instagram or Facebook settings, or deleting your Outlly account deletes them straight away. Meta&rsquo;s data deletion request does the same: it removes the connected account and its messages and gives you a confirmation code.
          </p>

          <h2 id="data-deletion">Disconnecting and deleting your data</h2>
          <ul>
            <li><strong>Disconnect a platform:</strong> open Accounts and choose Disconnect. The stored tokens for that platform, and any direct messages from it, are deleted straight away. You can also remove Outlly from the platform’s own settings (connected apps or business integrations), which stops access from their side too.</li>
            <li><strong>Delete media or posts:</strong> from the content library, at any time.</li>
            <li><strong>Delete your account:</strong> open Settings, then Your data, and choose Delete account. Your account, media, posts, connected accounts, comments, analytics and payment records are deleted straight away. Invoices are the one exception (see below). You can also ask from the Pip chat or the <a href="/contact">contact page</a> using your account email.</li>
            <li><strong>Take a copy:</strong> Settings, Your data, Download my data gives you a readable PDF with your profile, posts, schedule, library details, direct messages and invoices, or the same data as a JSON file to move to another service. Passwords and access tokens are never included.</li>
          </ul>
          <p>
            Invoices stay on your Billing page for as long as you have an account. If you delete it, each invoice is kept until 8 years after the date it was issued, because Indian tax law requires it, and is then deleted automatically. A kept invoice holds only what was printed on it: the invoice number, date, plan, amount, tax and the name and email it was made out to. It is no longer linked to any account. Drafts nobody has touched for 3 days are removed
            automatically. Email logs are deleted after 90 days, post metric history after 180 days and sign-in codes after one day. Your source files stay downloadable from the library for as long as your account exists.
          </p>

          <h2>Your rights</h2>
          <p>
            You can ask for a copy of your data, ask us to correct or delete it, or withdraw a permission you gave, under India’s Digital
            Personal Data Protection Act and, where it applies to you, the GDPR. Ask through the <a href="/contact">contact page</a> and we
            reply within 30 days. If you are not happy with our answer, you can complain to your data protection authority.
          </p>

          <h2>Security</h2>
          <p>
            Connections use HTTPS. Platform tokens are encrypted at rest and never reach the browser. Every request that changes something is
            checked to come from Outlly itself, and teammates only get the access their role allows.
          </p>

          <h2>Children</h2>
          <p>Outlly is not for anyone under 18, and we do not knowingly collect data from children.</p>

          <h2>Changes</h2>
          <p>
            If we start storing something new, ask a platform for a new permission, or send data somewhere new, this page is updated and the
            date at the top moves. Material changes are also announced in the app.
          </p>

          <h2>Asking us something</h2>
          <p>
            Questions about any of this, including a deletion request, go through the <a href="/contact">contact page</a> or Pip, the chat in
            the corner.
          </p>
        </Prose>
      </Shell>
    </section>
  );
}
