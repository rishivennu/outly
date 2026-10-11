import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Collectible } from "@/components/shared/Collectible";
import { OutlyLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-dvh overflow-hidden lg:grid-cols-[1.1fr_1fr]">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="animate-morph absolute -left-32 top-10 h-[560px] w-[560px] bg-lime opacity-20 blur-[120px]" />
        <div className="animate-morph absolute -bottom-40 left-1/4 h-[420px] w-[420px] bg-accent opacity-[0.18] blur-[130px] [animation-delay:-5s]" />
      </div>
      <div className="fixed right-4 top-4 z-20 flex items-center gap-2">
        <Link href="/" className="glass hairline inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-foreground/85 transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Website
        </Link>
        <ThemeToggle compact />
      </div>
      <section className="relative hidden flex-col justify-between p-12 lg:flex" aria-hidden="true">
        <OutlyLogo size={34} className="text-xl" />
        <div>
          <h1 className="display text-[clamp(4rem,7vw,7.5rem)] uppercase">
            Make it once.
            <br />
            <span className="energy-text">Post it</span>
            <br />
            everywhere.
          </h1>
          <div className="mt-10 flex items-center gap-3">
            <Collectible platform="instagram" size={58} float />
            <Collectible platform="youtube" size={58} float className="[&_.collectible-box]:[animation-delay:-2s]" />
            <Collectible platform="x" size={58} float className="[&_.collectible-box]:[animation-delay:-4s]" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">One video. Every platform. Zero chaos.</p>
      </section>
      <section className="relative flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
