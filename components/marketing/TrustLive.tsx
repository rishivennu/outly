"use client";
import { useEffect, useRef, useState } from "react";
import { Dot, useLiveView } from "@/components/shared/LiveCount";
import { Check } from "lucide-react";

/** Every line is true in the code today. `note` is the short form printed on the receipt. */
const LINES = [
  { item: "Sign-ins encrypted", note: "AES-256-GCM", body: "Instagram, YouTube and X access is stored encrypted, never in plain text." },
  { item: "Two-step sign-in", note: "every plan", body: "Add a code from an authenticator app to your login, from Settings." },
  { item: "Official APIs only", note: "no bots", body: "Posts go through each platform's own API." },
  { item: "Your data", note: "export / delete", body: "Take everything with you or delete your account yourself, any time." },
  { item: "Card details", note: "gateway only", body: "Payments run in the gateway's own checkout." },
];
const ZEROS = [
  { label: "passwords to your channels we ask for", why: "You sign in on Instagram, YouTube or X itself. We get a revocable key, never the password." },
  { label: "card numbers we store", why: "Stripe, Razorpay or UPI take the payment on their own page." },
  { label: "bots posting for you", why: "Nothing goes out unless you scheduled it or pressed publish." },
];
/** Fixed, decorative barcode: widths from a short seed so server and browser draw the same thing. */
const BARS = "3121413211231412213114123121".split("").map(Number);

/**
 * The receipt (1048). It prints out of the slot once when it scrolls into view (stepped, like a till printer),
 * then the three zeros roll down into place. Reduced motion: it's simply there. Without JS: also simply there.
 * Creators and "online now" come from the once-a-minute live poll; posts and platforms are the server's counts.
 */
export function TrustLive({ creators, posts, platforms }: { creators: number; posts: string | null; platforms: number }) {
  const v = useLiveView();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"wait" | "printed">("wait");
  const [stamp, setStamp] = useState<string | null>(null);

  useEffect(() => {
    setStamp(new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }));
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setState("printed");
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setState("printed");
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const total = v?.total ?? (creators > 0 ? creators : null);
  const fmt = (n: number) => n.toLocaleString("en-US");
  const counts = [
    total !== null && { k: total === 1 ? "Creator on Outlly" : "Creators on Outlly", v: fmt(total) },
    v?.online != null && { k: "Online right now", v: fmt(v.online), live: true },
    posts && { k: "Posts published for real", v: posts },
    platforms > 0 && { k: platforms === 1 ? "Platform live today" : "Platforms live today", v: String(platforms) },
  ].filter(Boolean) as { k: string; v: string; live?: boolean }[];

  return (
    <div ref={ref} className="tr-stage mt-10" data-print={state}>
      <div className="tr-printer">
        <div className="tr-slot" aria-hidden="true"><span /></div>
        <div className="rcpt-feed">
        <article className="rcpt" aria-label="Outlly security receipt">
          <header className="text-center">
            <p className="rcpt-brand">OUTLLY</p>
            <p className="rcpt-dim">Security receipt</p>
            <p className="rcpt-dim tabular">{stamp ? `Printed ${stamp}` : "Printed live"}</p>
          </header>
          <hr className="rcpt-rule" />
          {counts.length > 0 && (
            <>
              <dl className="rcpt-rows">
                {counts.map((c) => (
                  <div key={c.k} className="rcpt-row">
                    <dt className="flex items-center gap-1.5">{c.k}{c.live && <Dot />}</dt>
                    <dd className="tabular">{c.v}{c.live && <span className="sr-only"> (live)</span>}</dd>
                  </div>
                ))}
              </dl>
              <hr className="rcpt-rule" />
            </>
          )}
          <ul className="rcpt-rows">
            {LINES.map((l) => (
              <li key={l.item} className="rcpt-item">
                <div className="rcpt-row">
                  <span>{l.item}</span>
                  <span className="rcpt-ok"><span className="rcpt-note">{l.note}</span> <Check className="rcpt-tick" aria-hidden="true" /></span>
                </div>
                <p className="rcpt-body">{l.body}</p>
              </li>
            ))}
          </ul>
          <hr className="rcpt-rule rcpt-rule-double" />
          <div className="rcpt-row rcpt-total">
            <span>You owe us your password</span>
            <span className="tabular">NEVER</span>
          </div>
          <svg className="rcpt-barcode" viewBox={`0 0 ${BARS.reduce((a, b) => a + b + 1, 0)} 24`} preserveAspectRatio="none" aria-hidden="true">
            {BARS.reduce<{ x: number; els: React.ReactNode[] }>((acc, w, i) => {
              acc.els.push(<rect key={i} x={acc.x} y="0" width={w} height="24" />);
              acc.x += w + 1 + (i % 3);
              return acc;
            }, { x: 0, els: [] }).els}
          </svg>
          <p className="rcpt-dim text-center">Counted from the database. Demo accounts and practice posts left out.</p>
        </article>
        </div>
      </div>

      <ul className="tr-zeros" aria-label="Things Outlly never does">
        {ZEROS.map((z, i) => (
          <li key={z.label} className="tr-zero" style={{ ["--i" as string]: i }}>
            <span className="tr-digit display" aria-hidden="true">
              <span className="tr-reel">{[9, 7, 4, 2, 1, 0].map((n) => <span key={n}>{n}</span>)}</span>
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold leading-snug tracking-tight"><span className="sr-only">Zero </span>{z.label}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{z.why}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
