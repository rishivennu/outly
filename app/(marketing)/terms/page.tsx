import type { Metadata } from "next";
import { PageHead, Prose, Shell } from "@/components/marketing/bits";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms of using Outlly: what you keep, plans and billing, and the rules of Instagram, YouTube, X, TikTok, Threads, Facebook and LinkedIn that apply when you publish through us.",
  alternates: { canonical: "/terms" },
  openGraph: { title: "Terms · Outlly", description: "The terms of using Outlly.", url: "/terms" },
};

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

export default function TermsPage() {
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead
          title="Terms"
          updated="30 October 2026"
          lead="Short and specific. By creating an account or using Outlly, you agree to these terms and to our Privacy page."
        />

        <Prose>
          <h2>Who can use Outlly</h2>
          <p>
            You must be at least 18 and allowed to use every platform you connect. If you use Outlly for a business or a client, you confirm
            you are allowed to accept these terms for them.
          </p>

          <h2>Your account and your team</h2>
          <ul>
            <li>Keep your sign-in details safe. You are responsible for what happens in your studio.</li>
            <li>If you invite teammates, they act on your behalf within the role you give them. Only you, the owner, can connect or disconnect platform accounts, change billing, or delete the studio.</li>
            <li>People you ask to review a post through an approval link can see that post until they respond or the link expires.</li>
          </ul>

          <h2>Your content stays yours</h2>
          <p>
            You keep ownership of everything you upload and publish. You give us only the permission needed to run Outlly for you: to store
            your files, inspect or convert them where that is needed, create the drafts you ask for, and send your posts to the platforms you
            choose, at the time you choose.
          </p>

          <h2>Connecting social accounts</h2>
          <p>
            When you connect Instagram, YouTube, X, TikTok, Threads, Facebook or LinkedIn, you authorise Outlly to act for you through that
            platform’s official API, and only to do what you ask: publish or schedule your posts, check their status, show your numbers, and
            read or reply to comments where Outlly supports it. We never post anything you did not create or schedule. You can disconnect any
            platform at any time from Accounts, or from the platform’s own settings.
          </p>
          <p>Each platform’s own rules apply to everything you publish there, and by publishing through Outlly you agree to them:</p>
          <ul>
            <li><strong>YouTube:</strong> by using Outlly’s YouTube features you agree to be bound by the <a href="https://www.youtube.com/t/terms" {...ext}>YouTube Terms of Service</a>, and Google’s handling of your data is covered by the <a href="https://policies.google.com/privacy" {...ext}>Google Privacy Policy</a>.</li>
            <li><strong>Instagram:</strong> the <a href="https://help.instagram.com/581066165581870" {...ext}>Instagram Terms of Use</a>. Publishing needs an Instagram professional (business or creator) account.</li>
            <li><strong>Facebook and Threads:</strong> the <a href="https://www.facebook.com/terms.php" {...ext}>Meta Terms</a> and the Threads terms. Facebook publishing needs a Page you manage.</li>
            <li><strong>TikTok:</strong> the <a href="https://www.tiktok.com/legal/page/global/terms-of-service/en" {...ext}>TikTok Terms of Service</a>. By posting to TikTok through Outlly you agree to TikTok’s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" {...ext}>Music Usage Confirmation</a>.</li>
            <li><strong>X:</strong> the <a href="https://x.com/tos" {...ext}>X Terms of Service</a>.</li>
            <li><strong>LinkedIn:</strong> the <a href="https://www.linkedin.com/legal/user-agreement" {...ext}>LinkedIn User Agreement</a>. Outlly posts to your own profile.</li>
          </ul>
          <p>
            Platforms can reject, limit, label or remove a post, change or withdraw their API, or suspend an account, for reasons we cannot see
            or control. Access tiers, rate limits and app review decisions belong to them. If a platform withdraws access, that destination
            stops working until it is restored, and we will tell you in the app.
          </p>

          <h2>What you are responsible for</h2>
          <ul>
            <li>Having the rights to the video, audio, music, brands and people in what you upload.</li>
            <li>Following the law and each platform’s rules, including their rules on ads, branded content and disclosures.</li>
            <li>Not using Outlly for spam, impersonation, misleading or harmful content, mass automated posting, or anything that breaks a platform’s developer terms.</li>
            <li>Not trying to break, overload, reverse engineer or get around the limits of Outlly.</li>
          </ul>

          <h2>AI features</h2>
          <p>
            AI captions, hooks, titles, hashtags, transcripts, reply suggestions and insights are drafts. They can be wrong. Read them before you
            publish. You are responsible for what you post, whoever or whatever wrote the first draft.
          </p>

          <h2>Plans and billing</h2>
          <ul>
            <li>Outlly has a Free plan and paid plans. Each plan’s price, posts per month, total storage, AI features and team seats are shown in Billing before you pay, with taxes where they apply. Prices are in the currency of the country you are in.</li>
            <li>Storage is the total size of everything your account keeps, on every device. If you move to a plan with less storage, your files stay, but new uploads pause until you are under the new allowance.</li>
            <li>Each payment covers one month or one year, as shown next to the button before you pay. Plans do not renew automatically and we never charge you again without a new payment from you. When the period ends, you can pay for another one or your account moves to Free. Payments are taken by Stripe, Razorpay, PayPal or UPI, under their terms.</li>
            <li>You can cancel any time in Billing. You keep your plan until the end of the period you paid for, then your account moves to Free. You can resume before that date.</li>
            <li>If we change a plan’s price, the price you pay now stays the same until your current period ends, and we tell you before the new price applies.</li>
            <li>If you were charged by mistake or something did not work, ask from the Pip chat. A person reviews every refund request, and refunds go back to the original payment method.</li>
            <li>Refer and Earn: when a friend signs up through your referral link and makes their first payment for Creator, Studio or Pro, you get one month of Creator free, once their payment is confirmed and their email address is verified. If you are on a paid plan, the month starts when your current paid period ends. Each friend who pays earns one month; one reward per friend and per inbox, and signing up yourself through your own link does not count.</li>
            <li>Referral rewards and plans given by Outlly have no cash value. A referral month is withdrawn if the payment that earned it is refunded or charged back, or if the link is abused.</li>
          </ul>

          <h2 id="copyright">Copyright complaints</h2>
          <p>
            If something published or stored through Outlly uses your work without permission, email <a href="mailto:support@outlly.com">support@outlly.com</a> with
            the subject &ldquo;Copyright notice&rdquo; and include: the work you own, where it appears on Outlly, your name, address, phone and email, a statement
            that you believe in good faith the use is not authorised, a statement that your notice is accurate and that you are the owner or allowed to act for
            them, and your physical or electronic signature. We act on complete notices quickly and tell the account holder, who can send a counter-notice.
            Accounts that infringe repeatedly are closed.
          </p>

          <h2>What we are responsible for</h2>
          <p>
            Running Outlly with reasonable care, keeping your uploads private, telling you honestly when a publish fails and why, and not using
            your content for anything you did not ask for. Outlly is provided as it is. We are not responsible for a platform’s decisions, for
            the reach or performance of what you publish, or for losses we could not reasonably foresee. As far as the law allows, our total
            responsibility to you is limited to what you paid us in the 12 months before the problem. Nothing here limits rights you have
            under consumer law.
          </p>

          <h2>Keep your own copies</h2>
          <p>
            Features change, limits change, and downtime happens. Do not make Outlly the only copy of anything you care about. Keep your source
            files on your own device or drive as well.
          </p>

          <h2>Ending it</h2>
          <p>
            You can stop using Outlly and ask us to delete your account at any time, as described on the <a href="/privacy#data-deletion">Privacy page</a>.
            We may suspend or close an account that breaks these terms or a platform’s rules, and we will tell you why where we are allowed to.
            If we ever close Outlly, we will give you notice and time to download your files.
          </p>

          <h2>Changes</h2>
          <p>
            When these terms change, the date at the top moves, and material changes are announced in the app before they apply. Using
            Outlly after that means you accept the new terms.
          </p>

          <h2>Law</h2>
          <p>These terms are governed by the laws of India, and the courts of India have jurisdiction, without taking away protections your local law gives you.</p>

          <h2>Questions</h2>
          <p>
            Anything unclear here is worth asking about. Use the <a href="/contact">contact page</a> or Pip, the chat in the corner.
          </p>
        </Prose>
      </Shell>
    </section>
  );
}
