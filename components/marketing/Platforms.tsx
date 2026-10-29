import { ChevronRight } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { Pip } from "@/components/brand/Pip";
import { Reveal } from "./Reveal";
import { Shell } from "./bits";
import { SignupCta } from "./SignupCta";
import { Av, Bars, Bolt, Graph, Rings } from "./bento/Art";
import { LimeCta } from "./bento/LimeCta";
import { PLATFORM_PITCH } from "@/lib/marketing/content";
import { liveNow } from "@/lib/social/registry";
import type { Platform } from "@/lib/domain";

const WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

/**
 * "Supported destinations" on the shared bento (10-15e), the same tile system as the Demo:
 * every tile is a glowing picture, a title and one grey line; one solid lime tile is the sign-up.
 * The per-place detail (formats and limits) lives in an sr-only list so the page stays short.
 * The list follows the admin's platform keys, so a platform moves up the moment it goes live.
 */
export async function Platforms({ showCompare = true, live: forced }: { showCompare?: boolean; live?: Platform[] } = {}) {
  const live = forced ?? (await liveNow());
  const on = PLATFORM_PITCH.filter((p) => live.includes(p.id));
  const soon = PLATFORM_PITCH.filter((p) => !live.includes(p.id));
  const n = on.length;
  const count = WORD[n] ?? String(n);
  const first = on[0];

  return (
    <section id="platforms" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="platforms-title">
      <Shell>
        <Reveal className="bx-head">
          <div className="min-w-0">
            <h2 id="platforms-title" className="display mt-3 text-balance">
              {count} places, <span className="accent-serif bx-accent">properly</span> supported.
            </h2>
            <p className="bx-lead">Each place gets its own fields, its own limits and its own status.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <SignupCta className="bx-cta" />
            {showCompare && (
              <a href="#compare" className="bx-link">
                Compare tools <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        </Reveal>

        <ul className="sr-only" aria-label="What each live place supports">
          {on.map((p) => (
            <li key={p.id}>
              {p.name} {p.format}: {p.specs.join(", ")}. {p.needs}
            </li>
          ))}
        </ul>

        <Reveal y={0} fx="tiles" className="bx">
          <div className="bx-col">
            <div className="bx-tile bx-live">
              <div className="bx-art">
                <Bars />
              </div>
              <div className="bx-copy">
                <h3 className="bx-title">
                  {count} {n === 1 ? "place" : "places"} live today
                </h3>
                {on.length ? (
                  <ul className="bx-chips">
                    {on.map((p) => (
                      <li key={p.id}>{p.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="bx-sub">Switching on soon.</p>
                )}
              </div>
            </div>
            <div className="bx-tile">
              <div className="bx-art">
                <span className="bx-orbs" aria-hidden="true">
                  {PLATFORM_PITCH.map((p) => (
                    <span key={p.id} className={live.includes(p.id) ? "bx-orb" : "bx-orb is-off"}>
                      <AppIcon brand={p.id} size={24} />
                    </span>
                  ))}
                </span>
              </div>
              <div className="bx-copy">
                <h3 className="bx-title">Every place, one list</h3>
                <p className="bx-sub">
                  {soon.length ? `${soon.map((p) => p.name).join(", ")} switch on once approved.` : "Every place is live."}
                </p>
              </div>
            </div>
          </div>

          <div className="bx-col">
            <div className="bx-tile">
              <div className="bx-art">
                <Rings>
                  {on.slice(0, 4).map((p) => (
                    <Av key={p.id}>
                      <AppIcon brand={p.id} size={26} />
                    </Av>
                  ))}
                </Rings>
              </div>
              <div className="bx-copy">
                <h3 className="bx-title">Your accounts, side by side</h3>
                <p className="bx-sub">Connect each one once. We never ask for a password.</p>
              </div>
            </div>
            <div className="bx-tile">
              <div className="bx-art">
                <Bolt id="pf-bolt" />
              </div>
              <div className="bx-copy">
                <h3 className="bx-title">Limits checked first</h3>
                <p className="bx-sub">Every caption fits its place before anything is sent.</p>
              </div>
            </div>
            <div className="bx-tile bx-wide">
              <div className="bx-art">
                <div className="bx-msg" aria-hidden="true">
                  <span className="bx-msg-av">
                    <Pip size={28} mood="happy" />
                  </span>
                  <div className="min-w-0">
                    <b>Outlly</b>
                    <p>{first ? `Your ${first.name} ${first.format.replace(/s$/, "")} is live.` : "Your post is live."}</p>
                  </div>
                </div>
              </div>
              <div className="bx-copy">
                <h3 className="bx-title">Its own status</h3>
                <p className="bx-sub">One slow platform never holds up the rest.</p>
              </div>
            </div>
          </div>

          <div className="bx-col">
            <LimeCta title="Post everywhere from one upload." sub="Free to start. Connect your first account in a minute." />
            <div className="bx-tile bx-wide bx-row-sm">
              <div className="bx-art">
                <Graph id="pf-graph" />
              </div>
              <div className="bx-copy">
                <h3 className="bx-title">Track every place</h3>
                <p className="bx-sub">Queued, processing, live: one place at a time.</p>
              </div>
            </div>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
