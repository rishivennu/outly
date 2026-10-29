/**
 * Play Store and App Store badges (1037), shown as "Coming soon": the mobile apps are in development, so
 * these are labels, not links, and never point at a store page that doesn't exist yet. Monochrome on
 * purpose: they take the footer's ink, so they sit in the brand palette in both themes.
 */
const PLAY = "M3.6 1.8c-.3.3-.5.8-.5 1.4v17.6c0 .6.2 1.1.5 1.4l.1.1 9.9-9.9v-.2L3.7 1.7l-.1.1zm13.3 13.4-3.3-3.3v-.2l3.3-3.3.1.1 3.9 2.2c1.1.6 1.1 1.7 0 2.3l-3.9 2.2h-.1zm-.1.1L13.4 12 3.6 21.9c.4.4 1 .4 1.7.1l11.5-6.7M16.8 8.7 5.3 2.1c-.7-.4-1.3-.3-1.7.1l9.8 9.8 3.4-3.3z";
const APPLE = "M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z";

function Badge({ path, top, name }: { path: string; top: string; name: string }) {
  return (
    <li className="ft-chip inline-flex h-12 items-center gap-2.5 rounded-2xl px-3.5 text-foreground ring-1 ring-foreground/20" aria-label={`${name} app, coming soon`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
      <span className="flex flex-col leading-tight" aria-hidden="true">
        <span className="text-[10.5px] font-medium text-foreground/70">{top}</span>
        <span className="text-[14px] font-semibold">{name}</span>
      </span>
      <span className="ml-1 rounded-full bg-[hsl(var(--lime))] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--lime-foreground))]" aria-hidden="true">
        Coming soon
      </span>
    </li>
  );
}

export function StoreBadges({ className }: { className?: string }) {
  return (
    <div className={className}>
      <p className="ft-head mb-2 font-sans text-[11.5px] font-semibold text-foreground/70">Mobile apps in development</p>
      <ul className="flex flex-wrap gap-2" aria-label="Mobile apps, coming soon">
        <Badge path={PLAY} top="Android app on" name="Google Play" />
        <Badge path={APPLE} top="iPhone app on the" name="App Store" />
      </ul>
    </div>
  );
}
