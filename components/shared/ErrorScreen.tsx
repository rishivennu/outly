import Link from "next/link";
import { Pip, type PipMood } from "@/components/brand/Pip";

/** Friendly error layout: what happened, then concrete next steps, never just a code. */
export function ErrorScreen({ code, title, body, mood = "sad", actions }: { code?: string; title: string; body: string; mood?: PipMood; actions: React.ReactNode }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="admin-page-in flex max-w-md flex-col items-center text-center">
        <Pip size={120} mood={mood} />
        {code && <p className="eyebrow mt-6">{code}</p>}
        <h1 className="display mt-2 text-[clamp(2rem,6vw,3rem)]">{title}</h1>
        <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">{actions}</div>
        <p className="mt-8 text-[13px] text-muted-foreground">
          Still stuck? <Link href="/help" className="font-medium text-foreground underline underline-offset-4">Visit the help centre</Link> or ask Pip, bottom right.
        </p>
      </div>
    </main>
  );
}
export const pill = "inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold transition-transform active:scale-[0.97]";
