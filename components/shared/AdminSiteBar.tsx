"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Construction, Hourglass, X } from "lucide-react";

/**
 * Admins skip the maintenance page on purpose (so they can still check the site), which made the
 * switch look broken. This bar tells a signed-in admin what visitors are actually seeing.
 * Driven by the outlly_af cookie the middleware sets for verified admins only.
 */
function readFlags() {
  const m = document.cookie.match(/(?:^|;\s*)outlly_af=([a-z]+)/);
  return m ? m[1] : "";
}

export function AdminSiteBar() {
  const pathname = usePathname();
  const [flags, setFlags] = useState("");
  const [hidden, setHidden] = useState(false);
  useEffect(() => setFlags(readFlags()), [pathname]);
  if (!flags || hidden || pathname.startsWith("/admin") || pathname === "/maintenance") return null;
  const m = flags.includes("m"), w = flags.includes("w");
  return (
    <div role="status" className="fixed bottom-[calc(env(safe-area-inset-bottom)+88px)] left-1/2 z-[90] flex w-[min(720px,calc(100vw-1.5rem))] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] bg-foreground px-4 py-3 text-[13px] leading-snug text-background shadow-2xl lg:bottom-6">
      {m ? <Construction className="h-4 w-4 shrink-0 text-lime" aria-hidden /> : <Hourglass className="h-4 w-4 shrink-0 text-lime" aria-hidden />}
      <span className="min-w-0 flex-1 basis-[240px]">
        {m && <><strong className="font-semibold">Maintenance is on.</strong> Visitors and customers see the maintenance page; you see the site because you're signed in as admin.</>}
        {m && w && " "}
        {w && <><strong className="font-semibold">Waitlist is on.</strong> New visitors who press sign up go to the waitlist.</>}
      </span>
      {m && <Link href="/maintenance" className="inline-flex min-h-[32px] items-center rounded-full bg-lime px-3 font-semibold text-lime-foreground">Preview it</Link>}
      {!m && w && <Link href="/waitlist" className="inline-flex min-h-[32px] items-center rounded-full bg-lime px-3 font-semibold text-lime-foreground">See the waitlist</Link>}
      <Link href={m ? "/admin/maintenance" : "/admin/waitlist"} className="inline-flex min-h-[32px] items-center rounded-full px-3 underline underline-offset-4">Change in admin</Link>
      <button type="button" onClick={() => setHidden(true)} aria-label="Hide this notice" className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-background/15">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
