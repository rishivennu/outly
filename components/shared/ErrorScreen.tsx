import Link from "next/link";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { StarField } from "@/components/marketing/StarField";

/**
 * Friendly error layout: what happened, then concrete next steps, never just a code.
 * Always the night sky (same galaxy as sign in), so the text is set light on dark in both themes.
 */
export function ErrorScreen({ code, title, body, mood = "sad", actions }: { code?: string; title: string; body: string; mood?: PipMood; actions: React.ReactNode }) {
  return (
    <main id="main" className="err-galaxy relative isolate grid min-h-dvh place-items-center overflow-hidden bg-[#030705] px-6 py-16">
      <StarField variant="space" />
      <div className="admin-page-in relative z-10 flex max-w-md flex-col items-center text-center">
        <Pip size={120} mood={mood} />
        {code && <p className="err-eyebrow mt-6 rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.1em]">{code}</p>}
        <h1 className="display mt-3 text-[clamp(2rem,6vw,3rem)]">{title}</h1>
        <p className="err-muted mt-3 text-[15.5px] leading-relaxed">{body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">{actions}</div>
        <p className="err-muted mt-8 text-[13px]">
          Still stuck? <Link href="/help" className="err-link font-medium underline underline-offset-4">Visit the help centre</Link> or ask Pip, bottom right.
        </p>
      </div>
    </main>
  );
}
export const pill = "inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold transition-transform active:scale-[0.97]";
/** Secondary button on the dark sky. */
export const ghostPill = `${pill} err-ghost`;
