import { Reveal } from "./Reveal";
import { splitWords } from "./Split";
import { cn } from "@/lib/utils";
import { ScrambleText } from "@/components/ui/text-fx";

/** Page gutter. One value everywhere so sections line up at every width. */
export function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1240px] px-5 sm:px-8", className)}>{children}</div>;
}

/**
 * Section opening. The eyebrow carries the number so headings stay semantic
 * and the h2 stays the only thing a screen reader announces as a heading.
 */
export function SectionHead({
  eyebrow,
  title,
  body,
  id,
  align = "left",
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  id?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <Reveal y={0} className={cn("rv-head", align === "center" && "mx-auto text-center", "max-w-2xl", className)}>
      <p className="rv-eyebrow eyebrow mb-5"><ScrambleText text={eyebrow} /></p>
      <h2 id={id} className="display text-balance text-[clamp(1.875rem,2.6vw+1rem,2.625rem)]">
        {/* words unfold one after another when the head scrolls in (Play pass in globals.css) */}
        <span className="rv-words">{splitWords(title).nodes}</span>
      </h2>
      {body && <p className="rv-body rv-kw mt-4 text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">{splitWords(body).nodes}</p>}
    </Reveal>
  );
}

/** The dashed route from the hero, reused as a section divider. */
export function RouteRule({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-10", className)} aria-hidden="true" data-route="">
      <svg viewBox="0 0 1200 40" preserveAspectRatio="none" className="h-full w-full">
        <path d="M0 20 H1200" fill="none" stroke="hsl(var(--border))" strokeWidth="2" strokeDasharray="2 12" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Legal / long-form text. Set narrow on purpose: 66 characters is the target measure. */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[68ch] [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-2 [&_h2]:mb-3 [&_h2]:mt-12 [&_h2]:text-[1.35rem] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:text-[1.05rem] [&_h3]:font-semibold [&_li]:mb-2 [&_li]:text-[15px] [&_li]:leading-relaxed [&_li]:text-muted-foreground [&_p]:mb-4 [&_p]:text-[15px] [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5">
      {children}
    </div>
  );
}

/** Shared masthead for the legal and contact pages. */
export function PageHead({ title, updated, lead }: { title: string; updated?: string; lead: string }) {
  return (
    <div className="max-w-2xl">
      <h1 className="display text-balance text-[clamp(2.4rem,6.5vw,4rem)]">{title}</h1>
      {updated && <p className="mt-3 text-[14px] text-muted-foreground">Last updated {updated}</p>}
      <p className="mt-6 text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{lead}</p>
    </div>
  );
}
