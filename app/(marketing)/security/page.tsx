import type { Metadata } from "next";
import { PageHead, Prose, Shell } from "@/components/marketing/bits";

export const metadata: Metadata = {
  title: "Security",
  description: "How Outlly protects your account, your connected platforms and your payments, in plain words, and how to report a security problem.",
  alternates: { canonical: "/security" },
  openGraph: { title: "Security · Outlly", description: "How Outlly protects your account, platforms and payments.", url: "/security" },
};

/* Every claim on this page is backed by the code cited next to it. Change the code, change the page. */
export default function SecurityPage() {
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead title="Security" updated="14 November 2026" lead="What Outlly does to keep your account, your connected platforms and your payments safe, in plain words. If something here is not true of the app, tell us." />

        <Prose>
          <h2>Your password and sign-in</h2>
          <ul>
            {/* lib/auth-provider.ts:52-55 (Supabase Auth holds passwords), lib/auth.ts:21-25 (bcrypt.hash(pw, 11) when Outlly checks it itself) */}
            <li>Your password is never stored as you typed it. It is checked by our sign-in provider, Supabase Auth, or, where Outlly checks it itself, kept only as a bcrypt hash.</li>
            {/* lib/otp/core.ts:5,13-18 (6 digits, 10 min, 5 tries, single use, keyed hash, 1 per minute, 5 per hour); lib/otp/whatsapp.ts:13,47,58 (same rules for WhatsApp) */}
            <li>Sign-in codes sent by email or WhatsApp are 6 random digits. Each one works once, expires after 10 minutes and allows 5 tries. We keep only a keyed hash of the code, and an address or number gets at most one new code a minute and five an hour.</li>
            {/* lib/otp/core.ts:6-8 (TOTP), lib/otp/two-factor.ts:213 (secret encrypted), components/settings/TwoStepCard.tsx */}
            <li>You can turn on two-step sign-in with an authenticator app. The secret behind it is stored encrypted.</li>
            {/* lib/auth.ts:81-84 (httpOnly, secure in production, sameSite lax) */}
            <li>Your session cookie can&rsquo;t be read by scripts on the page, and in production it is only sent over HTTPS.</li>
          </ul>

          <h2>Your connected platforms</h2>
          <ul>
            {/* lib/crypto.ts:8-9 (AES-256-GCM), lib/accounts.ts:27-28 and lib/live/account.ts:55-56 (tokens encrypted before they are saved) */}
            <li>When you connect Instagram, YouTube, X or another platform, the access tokens it gives us are encrypted with AES-256-GCM before they are saved.</li>
            {/* lib/accounts.ts:64,128 (accessToken encrypt(""), refreshToken null on disconnect) */}
            <li>Disconnecting a platform wipes its stored tokens.</li>
            {/* lib/messages/service.ts:66,85 (message text and previews encrypted) */}
            <li>Direct messages shown in your Inbox are stored encrypted too.</li>
          </ul>

          <h2>Payments</h2>
          <ul>
            {/* lib/billing/providers/index.ts:20-21,31-34 (Razorpay Checkout; Stripe Checkout sessions), lib/csp.ts:114,118 (Razorpay checkout frame) */}
            <li>Payments are handled by our payment provider, Razorpay (or Stripe where it is used). You enter card details in their checkout, not on an Outlly form.</li>
            {/* lib/billing/saved-cards-core.ts:2-4 (Razorpay tokenises the card; Outlly sees network, last 4, expiry) */}
            <li>Outlly never sees or stores your card number. A saved card is kept by Razorpay; we only see its network, last 4 digits and expiry, so you can tell your cards apart.</li>
          </ul>

          <h2>Protection built into every page</h2>
          <ul>
            {/* lib/csp.ts:105-129 (nonce, strict-dynamic, object-src none, frame-ancestors none), middleware.ts (buildCsp on every page request) */}
            <li>A strict Content Security Policy: a script runs only if this page load approved it, and no other site can show Outlly inside a frame.</li>
            {/* next.config.mjs:86-95 (X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS 2 years in production) */}
            <li>Browsers are told to use HTTPS only (for two years), not to guess file types, to share as little as possible about where you came from, and that Outlly never needs your camera, microphone or location.</li>
            {/* lib/http.ts:63-75 (assertSameOrigin) and lib/http.ts:133-140 (route() runs it first) */}
            <li>Every change you make (a post, a setting, a payment) must come from Outlly itself, so another site can&rsquo;t send one in your name.</li>
            {/* lib/http.ts:103-115,141-169 (per user and per network address limits on every route) */}
            <li>Every part of the API is rate limited, per signed-in account and per network address, so nobody can hammer sign-in or flood your studio.</li>
          </ul>

          <h2>Deleting your account</h2>
          <ul>
            {/* app/api/settings/account/route.ts:9-18 (DELETE, confirm, signs you out), lib/account.ts:139-149 (confirm with your email; Supabase Auth user deleted first), components/settings/YourDataCard.tsx */}
            <li>You can delete your account yourself from Settings, by typing your email to confirm. Your password stops working and your studio and everything in it are deleted.</li>
            {/* lib/account.ts:170-172, lib/account-cleanup-core.ts:1-5,64-70 (each uploaded file removed with retries; status link) */}
            <li>Your uploaded videos and images are removed right after, retried until storage confirms they are gone, and you get a link that shows the progress.</li>
            {/* lib/account.ts:140-143 (invoices detached and kept for tax law) */}
            <li>Invoices are the one thing kept, because tax law requires it. They are detached from your account. The <a href="/privacy">privacy page</a> has the details.</li>
          </ul>

          <h2>Reporting a security problem</h2>
          {/* support@outlly.com: app/(marketing)/terms/page.tsx:95; the contact form: app/(marketing)/contact/page.tsx */}
          <p>
            Found a weakness? Email <a href="mailto:support@outlly.com?subject=Security%20report">support@outlly.com</a> with &ldquo;Security report&rdquo; in the subject, or use the{" "}
            <a href="/contact">contact form</a>. Tell us what you found and how to see it, and please give us a chance to fix it before you share it. Only test against your
            own account, and don&rsquo;t access, change or delete anyone else&rsquo;s data.
          </p>
        </Prose>
      </Shell>
    </section>
  );
}
