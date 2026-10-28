"use client";
import { Dot, useLiveView } from "@/components/shared/LiveCount";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";

type Cell = { value: string; label: string; dot?: boolean };

/**
 * Trust, live panel (1038). Creators and "online now" come from the same once-a-minute poll as the live strip,
 * so the numbers move while the page is open; posts and platforms are the server's counts. Every figure is real.
 */
export function TrustLive({ creators, posts, platforms }: { creators: number; posts: string | null; platforms: number }) {
  const v = useLiveView();
  const total = v?.total ?? (creators > 0 ? creators : null);
  const fmt = (n: number) => n.toLocaleString("en-US");
  const cells = [
    total !== null && { value: fmt(total), label: total === 1 ? "creator on Outlly" : "creators on Outlly" },
    v?.online != null && { value: fmt(v.online), label: "online right now", dot: true },
    posts && { value: posts, label: "posts published for real" },
    platforms > 0 && { value: String(platforms), label: platforms === 1 ? "platform live today" : "platforms live today" },
  ].filter(Boolean) as Cell[];
  return (
    <div className="flex h-full flex-col rounded-[2rem] bg-[hsl(var(--lime)/0.16)] p-6 hairline sm:p-8">
      <p className="inline-flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-foreground/75">
        <Dot /> Live right now
      </p>
      <Reveal as="ul" stagger y={18} delay={0.15} className="mt-6 grid flex-1 grid-cols-2 gap-3">
        {cells.map((c, i) => (
          <li key={c.label} className={cn("flex flex-col justify-end rounded-[1.25rem] bg-background/75 p-4 hairline sm:p-5", cells.length % 2 === 1 && i === 0 && "col-span-2")}>
            <p className={cn("display flex items-center gap-2 leading-none tabular", cells.length % 2 === 1 && i === 0 ? "text-[clamp(2.6rem,6vw,3.8rem)]" : "text-[clamp(2rem,4.4vw,2.8rem)]")}>
              {c.value}
              {c.dot && <span className="sr-only">(live)</span>}
            </p>
            <p className="mt-2 text-[14px] leading-snug text-muted-foreground">{c.label}</p>
          </li>
        ))}
      </Reveal>
      <p className="mt-5 text-[12.5px] leading-relaxed text-foreground/65">Counted from the database: creators and online update every minute, posts every few. Demo accounts and practice posts are left out.</p>
    </div>
  );
}
