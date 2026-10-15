import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { AuthShowcase } from "@/components/auth/AuthShowcase";

/**
 * Sign in and sign up share one floating card on the warm canvas: a panel of brand light on the left,
 * the form on the right. The layout persists between the two routes, so only the form swaps and the
 * light glides to a new spot. Below lg the panel steps aside and the form has the card to itself.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-canvas relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-secondary p-2.5 sm:p-5 lg:p-5">
      <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[70vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--lime)/0.10)] blur-[110px]" />
      <div className="grid w-full max-w-[1160px] gap-2.5 rounded-[28px] bg-card p-2.5 shadow-[0_40px_90px_-45px_hsl(var(--foreground)/0.45),0_0_0_1px_hsl(var(--border)/0.8)] sm:rounded-[34px] lg:min-h-[min(720px,calc(100dvh-2.5rem))] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AuthShowcase />
        <section className="relative flex min-h-[calc(100dvh-2.5rem)] flex-col px-3 pb-6 pt-1.5 sm:min-h-0 sm:px-8 lg:px-12">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Website
            </Link>
            <ThemeToggle compact plain />
          </div>
          <div className="flex flex-1 items-center justify-center py-6 lg:py-2">
            <div className="w-full max-w-[400px]">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
