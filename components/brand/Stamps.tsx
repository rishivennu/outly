import { cn } from "@/lib/utils";

/** Tiny perforated stamp, used as a label (hero "Beta" chip). */
export function StampChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("stamp-chip", className)}>
      <span className="stamp-chip-face">{children}</span>
    </span>
  );
}

const MINI = [
  { big: "REELS", no: "01", ink: "#b0186a", tilt: -9, x: "0%", y: "18%" },
  { big: "SHORTS", no: "02", ink: "#c4161c", tilt: 6, x: "34%", y: "0%" },
  { big: "POST", no: "03", ink: "#16161a", tilt: -3, x: "62%", y: "26%" },
];

/** Three platform stamps fanned out under a slowly turning Outly postmark. Pure decoration. */
export function StampCluster({ className }: { className?: string }) {
  return (
    <div className={cn("stamp-cluster", className)} aria-hidden="true">
      {MINI.map((s, i) => (
        <div key={s.big} className="stamp-mini" style={{ ["--ink" as string]: s.ink, ["--tilt" as string]: `${s.tilt}deg`, left: s.x, top: s.y, ["--i" as string]: i }}>
          <div className="stamp-perf">
            <div className="stamp-mini-face">
              <span className="stamp-mini-top">
                <span>OUTLY</span>
                <span>No.{s.no}</span>
              </span>
              <span className="stamp-mini-art" />
              <span className="stamp-mini-big">{s.big}</span>
            </div>
          </div>
        </div>
      ))}
      <SpinPostmark className="stamp-cluster-mark" />
    </div>
  );
}

export function SpinPostmark({ className, text = "ONE UPLOAD · THREE PLATFORMS · FREE IN BETA · " }: { className?: string; text?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={cn("spin-mark", className)} aria-hidden="true">
      <defs>
        <path id="spin-ring" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" />
      </defs>
      <g className="spin-mark-ring">
        <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <text fontSize="9.6" fontWeight="800" letterSpacing="2.2" fill="currentColor">
          <textPath href="#spin-ring">{text}</textPath>
        </text>
      </g>
      <circle cx="60" cy="60" r="32" fill="none" stroke="currentColor" strokeWidth="2" />
      <text x="60" y="57" textAnchor="middle" fontSize="13" fontWeight="900" letterSpacing="1.4" fill="currentColor">OUTLY</text>
      <text x="60" y="71" textAnchor="middle" fontSize="8" fontWeight="800" letterSpacing="2" fill="currentColor">POSTED</text>
    </svg>
  );
}
