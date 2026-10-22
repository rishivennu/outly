import { CometShower } from "./CometShower";

/**
 * Brand sky (10-16). Twinkling stars plus comets fired at random from the top-left, crossing the
 * whole view to the bottom right (CometShower.tsx).
 * - "page": follows the theme, sits behind public pages and the admin panel.
 * - "space": always deep space (auth pages): denser, tinted stars, nebula clouds and a faint
 *   milky-way band, so sign in / sign up feel like floating in a galaxy in both themes.
 * Stars are CSS on a fixed layer (transform + opacity only). Positions come from a seeded generator,
 * so server and browser render the same markup. Decorative: aria-hidden, pointer-events none.
 * Reduced motion: comets and drift off, stars still.
 */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type Star = { x: number; y: number; s: number; d: number; w: number; tint: number; glow: boolean };
function stars(seed: number, n: number, rich: boolean): Star[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const big = r();
    return {
      x: +(r() * 100).toFixed(2),
      y: +(r() * 100).toFixed(2),
      s: big < 0.12 ? 2.5 : big < 0.5 ? 1.5 : 1,
      d: +(3 + r() * 5).toFixed(2),
      w: +(-r() * 8).toFixed(2),
      tint: rich ? Math.floor(r() * 10) : 0, // 0-6 white, 7 lime, 8 cyan, 9 rose
      glow: rich && big < 0.05,
    };
  });
}
const PAGE = stars(1016, 56, false);
const SPACE = stars(2026, 150, true);
const TINT = ["", "", "", "", "", "", "", "sky-star-lime", "sky-star-cyan", "sky-star-rose"];
/**
 * Stars twinkle in a few groups, not one by one: each group is one layer whose opacity breathes on its
 * own clock. 5 to 7 animations instead of 56 to 150 keeps scrolling cheap, because every running
 * animation is restyled on each main-thread frame and smooth scroll makes every frame one.
 */
const GROUPS = { page: 5, space: 7 } as const;

export function StarField({ variant = "page", nebula = variant === "space", className }: { variant?: "page" | "space"; nebula?: boolean; className?: string }) {
  const list = variant === "space" ? SPACE : PAGE;
  return (
    <div className={["sky", variant === "space" ? "sky-space" : "", className ?? ""].join(" ").trim()} aria-hidden="true">
      {nebula && (
        <div className="sky-nebula">
          <span />
          <span />
          <span />
          <span />
          {variant === "space" && <i className="sky-band" />}
        </div>
      )}
      {Array.from({ length: GROUPS[variant] }, (_, g) => (
        <div key={g} className="sky-g" style={{ animationDuration: `${(4.6 + g * 1.35).toFixed(2)}s`, animationDelay: `${(-g * 1.9).toFixed(2)}s` }}>
          {list
            .filter((_, i) => i % GROUPS[variant] === g)
            .map((s, i) => (
              <span
                key={i}
                className={["sky-star", TINT[s.tint], s.glow ? "sky-star-glow" : ""].join(" ").trim()}
                style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s }}
              />
            ))}
        </div>
      ))}
      <CometShower dense={variant === "space"} />
    </div>
  );
}
