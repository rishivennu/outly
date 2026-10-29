import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/domain";
import { liveNow } from "@/lib/social/registry";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";

/**
 * "Publishes to" logo ticker under the hero (10-16): every platform's mark and name in one quiet grey,
 * drifting left. Live places come first; the rest carry a small "soon" tag so nothing is overclaimed.
 * Screen readers get one plain list; the moving copies are aria-hidden. Hover pauses it, and with
 * reduced motion it stops and wraps as a centred row (globals.css .lt-*).
 */
export async function LogoTicker({ live: forced }: { live?: Platform[] } = {}) {
  const live = forced ?? (await liveNow());
  const list = [...PLATFORMS].sort((a, b) => Number(live.includes(b)) - Number(live.includes(a)));
  const Item = ({ p }: { p: Platform }) => (
    <li className="lt-item">
      <PlatformGlyph platform={p} className="h-[22px] w-[22px] shrink-0" />
      <span className="text-[17px] font-semibold tracking-tight">{PLATFORM_META[p].name}</span>
      {!live.includes(p) && <span className="lt-soon">soon</span>}
    </li>
  );
  // Enough copies that one half is always wider than a large screen; the track moves by exactly one half.
  const half = [...list, ...list];
  return (
    <section aria-labelledby="lt-h" className="lt mx-auto w-full max-w-[1180px] px-5 pb-2 pt-16 sm:pt-20">
      <h2 id="lt-h" className="text-center text-[12px] font-semibold text-muted-foreground">
        Publishes to
      </h2>
      <ul className="sr-only">
        {list.map((p) => (
          <li key={p}>{PLATFORM_META[p].name}{live.includes(p) ? "" : " (coming soon)"}</li>
        ))}
      </ul>
      <div className="lt-viewport mt-4" aria-hidden="true">
        <div className="lt-track">
          {[0, 1].map((k) => (
            <ul key={k} className="lt-half">
              {half.map((p, i) => <Item key={`${k}-${i}`} p={p} />)}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
