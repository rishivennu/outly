import type { Metadata } from "next";
import { DeleteAccountRequest } from "@/components/account/DeleteAccountRequest";
import { PageHead, Prose, Shell } from "@/components/marketing/bits";

export const metadata: Metadata = {
  title: "Delete your account",
  description: "Delete your Outlly account and everything in it from this page, from Settings, or from the Android app. What goes, what is kept and why, and how long it takes.",
  alternates: { canonical: "/delete-account" },
  openGraph: { title: "Delete your account · Outlly", description: "Delete your Outlly account and everything in it. What goes, what is kept, how long it takes.", url: "/delete-account" },
};

/**
 * R1340: the public account-deletion page Google Play asks every app with accounts to publish (Play Console > App
 * content > Data deletion). The same deletion as Settings > Your data (lib/account.ts deleteAccount), reachable without
 * the app. Every claim below is backed by the code cited next to it. Change the code, change the page.
 */
export default function DeleteAccountPage() {
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead title="Delete your account" updated="27 November 2026" lead="You can delete your Outlly account yourself, here or in the app, and it takes effect straight away. This page explains what goes, what we keep and why, and how to do it even if you no longer have the app." />

        <div className="mt-10 max-w-2xl">
          <DeleteAccountRequest />
        </div>

        <Prose>
          <h2>Three ways to delete</h2>
          <ul>
            <li><strong>On this page:</strong> sign in, type your email to confirm, and it&rsquo;s done. You don&rsquo;t need the app installed.</li>
            {/* components/settings/YourDataCard.tsx (web), outlly-compose ui/settings/MoreSections.kt (Android) */}
            <li><strong>In the app or on the website:</strong> Settings, then Your data (web) or Account (Android app), then Delete account.</li>
            {/* The 30-day reply is the same commitment the privacy page makes under "Your rights" (app/(marketing)/privacy/page.tsx). */}
            <li><strong>If you can&rsquo;t sign in:</strong> email <a href="mailto:support@outlly.com?subject=Delete%20my%20account">support@outlly.com</a> from the address on the account, with &ldquo;Delete my account&rdquo; in the subject. We confirm it&rsquo;s you by replying to that address, then delete the account within 30 days, usually much sooner.</li>
          </ul>

          <h2>What gets deleted</h2>
          {/* lib/account.ts:139-149 (schema cascades from the User row; Supabase Auth user deleted first), :159-172 (uploads queued for durable cleanup), :175-178 (support tickets anonymised), :209-219 (derived AI profiles, clipper jobs, trial and signals) */}
          <ul>
            <li>Your profile, email, password and every sign-in session, on every device. Your password stops working first, before anything else is removed.</li>
            <li>Your posts, drafts, schedule, comments, replies and analytics history.</li>
            <li>Your media library: every uploaded video and image, and every thumbnail and cover made from them. Files are removed from storage right after the account, and retried until storage confirms they are gone.</li>
            <li>Your connected platforms (Instagram, YouTube, X and the rest): the access tokens Outlly held for them. Removing Outlly from each platform&rsquo;s own connected-apps settings stops access from their side as well.</li>
            {/* lib/billing/saved-cards-core.ts:1-4 (Razorpay tokenises the card; Outlly never sees or stores a number), components/settings billing "Remove card" */}
            <li>Direct messages shown in your Inbox, and your plan and payment records. A saved card was only ever held by the payment provider, never by Outlly; remove it on your Billing page first if you want it gone there too.</li>
            <li>Everything Outlly&rsquo;s AI features learned about your account: creator profiles, predictions and the learning log.</li>
            <li>Your name and email on any support conversation you had with us; the conversation itself is kept, anonymised, so our support history stays whole.</li>
          </ul>

          <h2>What is kept, and why</h2>
          <ul>
            {/* lib/account.ts:140-143,163-200 (invoices detached, snapshot columns filled, deleted by lib/retention/prune.ts after INVOICE_KEEP_YEARS) */}
            <li><strong>Invoices:</strong> each one is kept until 8 years after the date it was issued, because Indian tax law requires it, then deleted automatically. A kept invoice holds only what was printed on it (number, date, plan, amount, tax, the name and email it was made out to) and is no longer linked to any account.</li>
            {/* lib/account.ts:207-208,220-221 (offer-ledger and risk rows keep a one-way hash and dates, no owner) */}
            <li><strong>Fraud-prevention hashes:</strong> the one-way hashes that record that a free trial or a first-time price was used, with their dates and no link to any account, so a deleted-and-recreated account cannot take them twice.</li>
            <li><strong>Copies on the platforms:</strong> a post that is already live on Instagram, YouTube or another platform stays there under that platform&rsquo;s terms. Delete it from the platform if you want it gone.</li>
          </ul>

          <h2>How long it takes</h2>
          {/* app/api/settings/account/route.ts (session destroyed in the same request); lib/account-cleanup-core.ts (file cleanup with retries); app/(marketing)/account-deleted (status page) */}
          <p>
            The account, its data and your sign-in go in the same moment you confirm. Uploaded files are removed over the following minutes; you land on a status page that shows that cleanup finishing, and its link keeps working afterwards.
          </p>

          <h2>Before you go</h2>
          <ul>
            <li><strong>Take a copy:</strong> Settings, Your data, Download my data gives you a readable PDF or a JSON file with your profile, posts, schedule, library details, messages and invoices. Deletion can&rsquo;t be undone, so do this first if you&rsquo;ll want it later.</li>
            <li><strong>Only leaving one platform?</strong> Accounts, then Disconnect removes that platform&rsquo;s tokens and messages and keeps the rest of your studio.</li>
            <li><strong>Uninstalling the app does not delete your account.</strong> The account lives on outlly.com; use one of the three ways above.</li>
          </ul>

          <h2>Questions</h2>
          <p>
            Anything unclear, or a request about your data under India&rsquo;s Digital Personal Data Protection Act or the GDPR: the <a href="/privacy#data-deletion">privacy page</a> has the full detail, and <a href="/contact">contact us</a> replies within 30 days.
          </p>
        </Prose>
      </Shell>
    </section>
  );
}
