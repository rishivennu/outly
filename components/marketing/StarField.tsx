/**
 * Brand sky behind every public page (10-16): a scatter of twinkling stars and a few lime comets
 * that fall on a loop, echoing the rocket mark. Pure CSS on a fixed layer, so it is there in every
 * section as you scroll, costs no JS, and only animates transform + opacity (compositor only).
 * Positions come from a seeded generator, so server and browser render the same markup.
 * Decorative: aria-hidden, pointer-events none. Reduced motion: comets off, stars still.
 */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const r = rng(1016);
const STARS = Array.from({ length: 56 }, () => ({
  x: +(r() * 100).toFixed(2),
  y: +(r() * 100).toFixed(2),
  s: r() < 0.18 ? 2.5 : r() < 0.55 ? 1.5 : 1,
  d: +(3 + r() * 5).toFixed(2),
  w: +(-r() * 8).toFixed(2),
}));

// Comets start above or left of the view and fall toward the bottom right. Spread start times so
// at most one or two are in flight at once.
const COMETS = Array.from({ length: 7 }, (_, i) => ({
  x: +(-10 + r() * 85).toFixed(1),
  y: +(-12 + r() * 45).toFixed(1),
  a: +(26 + r() * 16).toFixed(1),
  len: Math.round(110 + r() * 120),
  d: +(10 + r() * 8).toFixed(1),
  w: +(-(i * 2.6 + r() * 1.5)).toFixed(1),
}));

export function StarField() {
  return (
    <div className="sky" aria-hidden="true">
      {STARS.map((s, i) => (
        <span
          key={i}
          className="sky-star"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDuration: `${s.d}s`, animationDelay: `${s.w}s` }}
        />
      ))}
      {COMETS.map((c, i) => (
        <span key={i} className="sky-comet" style={{ left: `${c.x}%`, top: `${c.y}%`, transform: `rotate(${c.a}deg)` }}>
          <span style={{ width: c.len, animationDuration: `${c.d}s`, animationDelay: `${c.w}s` }} />
        </span>
      ))}
    </div>
  );
}
