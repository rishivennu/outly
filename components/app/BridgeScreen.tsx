import type { ReactNode } from "react";

/** The quiet full-screen card the app shows while a sign-in or a share is handed over. */
export function BridgeScreen({ icon, title, body, children, busy = false }: { icon: ReactNode; title: string; body: string; children?: ReactNode; busy?: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-7 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] text-center">
      <div className="bridge-card w-full max-w-sm" role="status" aria-live="polite" aria-busy={busy}>
        <div className="mx-auto mb-6 grid h-[72px] w-[72px] place-items-center rounded-[24px] border border-white/10 bg-white/[0.06] text-[hsl(var(--lime))] backdrop-blur-xl" aria-hidden="true">
          {icon}
        </div>
        <h1 className="mb-2 text-[22px] font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
        <p className="mb-7 text-muted-foreground">{body}</p>
        {children && <div className="flex flex-col items-center gap-3">{children}</div>}
      </div>
    </main>
  );
}
