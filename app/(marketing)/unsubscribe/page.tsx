import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/marketing/bits";
import { Button } from "@/components/ui/button";
import { isSubscribed, readUnsubToken, type List } from "@/lib/email/unsubscribe";

export const metadata: Metadata = { title: "Email preferences", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAME: Record<List, string> = { news: "tips and product emails", weekly: "the weekly report" };

/** "naidu@gmail.com" -> "n••••@gmail.com": enough to recognise, not enough to harvest. */
function mask(email: string) {
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}`;
}

/**
 * Landing page for the Unsubscribe link in marketing email (10-26b). It never unsubscribes on GET:
 * mail scanners open every link, so the person presses a button first. The form posts to
 * /api/email/unsubscribe, which does the work and comes back here with ?done=out|in.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: { t?: string; done?: string } }) {
  const who = readUnsubToken(searchParams.t);
  if (!who) {
    return (
      <Frame title="This link doesn't work">
        <p>It may have been cut short when it was copied. Open the Unsubscribe link from the email again, or turn emails off in your settings.</p>
        <div className="mt-8"><Button asChild variant="lime"><Link href="/settings">Open settings</Link></Button></div>
      </Frame>
    );
  }
  const action = `/api/email/unsubscribe?t=${encodeURIComponent(searchParams.t!)}`;
  const list = NAME[who.list];
  const subscribed = await isSubscribed(who.email, who.list);
  const done = searchParams.done === "out" || searchParams.done === "in" ? searchParams.done : null;

  if (!subscribed) {
    return (
      <Frame title={done === "out" ? "You're unsubscribed" : "You're already unsubscribed"}>
        <p>
          <b className="text-foreground">{mask(who.email)}</b> won&apos;t get {list} any more. Account email (sign-in codes, receipts, replies to
          your support tickets) still arrives, because you need it to use Outlly.
        </p>
        <form method="post" action={action} className="mt-8">
          <input type="hidden" name="action" value="in" />
          <Button type="submit" variant="outline">I didn&apos;t mean to, keep sending them</Button>
        </form>
      </Frame>
    );
  }
  return (
    <Frame title={done === "in" ? "You're subscribed again" : `Stop getting ${list}?`}>
      <p>
        {done === "in" ? (
          <><b className="text-foreground">{mask(who.email)}</b> will get {list} again. You can leave any time from the link at the bottom of each email.</>
        ) : (
          <>This stops {list} going to <b className="text-foreground">{mask(who.email)}</b>. Sign-in codes, receipts and support replies still arrive.</>
        )}
      </p>
      {done !== "in" && (
        <form method="post" action={action} className="mt-8">
          <input type="hidden" name="action" value="out" />
          <Button type="submit" variant="lime">Unsubscribe</Button>
        </form>
      )}
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-16 sm:py-24" aria-labelledby="unsub-title">
      <Shell>
        <div className="max-w-xl">
          <p className="eyebrow mb-5">Email preferences</p>
          <h1 id="unsub-title" className="display text-balance text-[clamp(2.2rem,6vw,3.4rem)]">{title}</h1>
          <div className="mt-6 text-pretty text-[17px] leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </Shell>
    </section>
  );
}
