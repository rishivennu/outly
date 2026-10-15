import { Pip, type PipMood } from "@/components/brand/Pip";

export const metadata = { title: "Pip" };

const MOODS: { mood: PipMood; label: string; use: string }[] = [
  { mood: "idle", label: "Idle", use: "Empty states, help bot" },
  { mood: "wave", label: "Wave", use: "Greetings, chat button" },
  { mood: "think", label: "Think", use: "AI writing, checkout" },
  { mood: "happy", label: "Happy", use: "Post went out, goal kept" },
  { mood: "sad", label: "Sad", use: "Post failed, reconnect" },
  { mood: "fly", label: "Fly", use: "Publishing, loading" },
  { mood: "sleepy", label: "Sleepy", use: "Quiet week, win-back" },
  { mood: "dizzy", label: "Dizzy", use: "Error pages" },
];

/**
 * Design preview of every Pip mood. One canvas colour runs edge to edge across every section,
 * like the reference board, so the glow reads the same everywhere. Not linked from the nav.
 */
export default function MascotPage() {
  return (
    <div className="min-h-dvh bg-[#121117] px-5 pb-16 pt-8 text-[#f1f0f7] sm:px-10 lg:pt-14">
      <section aria-labelledby="pip-h" className="max-w-5xl">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#b4abff]">Brand</p>
        <h1 id="pip-h" className="display text-[clamp(2.4rem,5.5vw,4.2rem)]">Meet Pip.</h1>
        <p className="mt-3 max-w-xl text-[#c3c0d0]">A soft glow cloud. The light inside changes shape with the mood; the eyes do the talking.</p>
      </section>

      <section aria-label="Moods" className="mt-12 max-w-5xl">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4">
          {MOODS.map((m) => (
            <li key={m.mood} className="flex flex-col items-center gap-2 text-center">
              <Pip size={104} mood={m.mood} title={`Pip, ${m.label.toLowerCase()}`} />
              <span className="mt-2 font-semibold">{m.label}</span>
              <span className="text-[13px] text-[#a9a6b8]">{m.use}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Sizes" className="mt-14 max-w-5xl border-t border-white/10 pt-10">
        <div className="flex flex-wrap items-end gap-8">
          {[24, 32, 48, 64, 120].map((s) => <Pip key={s} size={s} mood="idle" />)}
        </div>
        <p className="mt-4 text-[13px] text-[#a9a6b8]">24, 32, 48, 64 and 120 px</p>
      </section>
    </div>
  );
}
