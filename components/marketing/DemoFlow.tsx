"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Info, Pause, Play, RotateCcw } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { cn } from "@/lib/utils";
import { Av, Bars, Bolt, Graph, Rings } from "./bento/Art";
import { Reveal } from "./Reveal";

/*
 * Demo on the shared bento (10-15e), the same tile system as Platforms: every tile is a glowing
 * picture, a title and one grey line. The tile for the step that is playing lights up; the one lime
 * tile carries the step in two words and the step dots. Nothing here talks to a server. Four beats
 * loop; the last deliberately shows a failure, because that is the state the product is designed around.
 * React re-renders only on beat changes; everything in between is CSS on the compositor.
 */

type Beat = 0 | 1 | 2 | 3;
const BEAT_MS = 2500;
const ORDER = ["instagram", "youtube", "x"] as const;
type Core = (typeof ORDER)[number];
const COUNT = ["None", "One", "Two", "Three"];
const NAME: Record<Core, string> = { instagram: "Instagram", youtube: "YouTube", x: "X" };

const BEATS = [
  { label: "Upload", caption: "One file lands in your library. Every place waits for it." },
  { label: "Tailor", caption: "AI writes copy in each place's own shape: a caption, a title, a post." },
  { label: "Send", caption: "Each place becomes its own job, with its own progress." },
  { label: "Track", caption: "One is live, one is processing, one needs a hand. Retry only that one." },
] as const;

type Tone = "idle" | "work" | "done" | "fail";
type Retry = "idle" | "running" | "done";

function state(p: Core, beat: Beat, retry: Retry): { status: string; tone: Tone; note: string } {
  if (p === "x" && beat === 3 && retry !== "idle")
    return retry === "running" ? { status: "retrying", tone: "work", note: "Sending a trimmed version." } : { status: "live", tone: "done", note: "Live, with a link to the post." };
  if (beat === 0) return { status: "waiting", tone: "idle", note: "Waiting for the upload to finish." };
  if (beat === 1) return { status: "draft ready", tone: "idle", note: "Draft ready. Edit it before anything is sent." };
  if (beat === 2) return { status: p === "youtube" ? "queued" : "uploading", tone: "work", note: "Uploading the video." };
  if (p === "instagram") return { status: "live", tone: "done", note: "Live, with a link to the post." };
  if (p === "youtube") return { status: "processing", tone: "work", note: "Still processing. We keep checking." };
  return { status: "needs a hand", tone: "fail", note: "X said the file is too long." };
}

/** The two words on the lime tile: what the beat amounts to. */
function headline(beat: Beat, done: number) {
  if (beat === 0) return ["One", "upload."];
  if (beat === 1) return ["Three", "drafts."];
  if (beat === 2) return ["Three", "sends."];
  return [COUNT[done], "live."];
}

export function DemoFlow() {
  const uid = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState<Beat>(0);
  const [retry, setRetry] = useState<Retry>("idle");
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [paused, setPaused] = useState(false);

  // Auto-play whenever the demo is on screen and the tab is visible. Only the Pause button stops it
  // (reduced motion still steps, the CSS just drops the movement).
  useEffect(() => {
    setMounted(true);
    const vis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", vis);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    if (root.current) io.observe(root.current);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      io.disconnect();
    };
  }, []);

  const running = mounted && visible && !hidden && !paused && retry !== "running";

  // Pausable beat clock: pausing keeps the time already spent.
  const remaining = useRef(BEAT_MS);
  const shownBeat = useRef<Beat>(0);
  useEffect(() => {
    if (shownBeat.current !== beat) {
      shownBeat.current = beat;
      remaining.current = BEAT_MS;
    }
    if (!running) return;
    const start = performance.now();
    const t = window.setTimeout(() => setBeat((b) => ((b + 1) % 4) as Beat), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(t);
      remaining.current -= performance.now() - start;
    };
  }, [beat, running]);

  useEffect(() => setRetry("idle"), [beat]);
  useEffect(() => {
    if (retry !== "running") return;
    const t = window.setTimeout(() => setRetry("done"), 1500);
    return () => window.clearTimeout(t);
  }, [retry]);

  const go = useCallback((b: Beat) => setBeat(b), []);
  const states = ORDER.map((p) => state(p, beat, retry));
  const done = states.filter((s) => s.tone === "done").length;
  const x = states[2];
  const [w1, w2] = headline(beat, done);
  const track = beat < 2 ? "Waiting to send." : ORDER.map((p, i) => `${NAME[p]} ${states[i].status}`).join(", ") + ".";

  return (
    <div
      ref={root}
      className="mx-auto w-full max-w-[1180px]"
      data-beat={beat}
      data-running={running ? "" : undefined}
      style={{ ["--beat" as string]: `${BEAT_MS}ms` }}
    >
      <div className="bx-head">
        <div className="min-w-0">
          <p className="bx-eyebrow">The flow, end to end</p>
          <h2 id="demo-title" className="display mt-3 text-balance">
            Watch one upload become <span className="accent-serif bx-accent">three posts.</span>
          </h2>
          <p className="bx-lead">Including the part where a platform says no.</p>
        </div>
        <p className="bx-note">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Illustration, not live data.
        </p>
      </div>

      <Reveal y={0} className="bx bx-demo">
        <div className="bx-col">
          <Tile on={beat === 0} live={beat === 0 && running} title="One upload" sub="desk-setup.mp4 lands in your library." art={<Bars />} />
          <Tile on={beat === 1} title="Three drafts" sub="A caption, a title and a post, each in its own shape." art={<Bolt id={`${uid}-bolt`} />} />
        </div>

        <div className="bx-col">
          <Tile
            on={beat === 2}
            title="Three sends"
            sub="Each place becomes its own job."
            art={
              <Rings>
                {ORDER.map((p) => (
                  <Av key={p}>
                    <AppIcon brand={p} size={26} />
                  </Av>
                ))}
              </Rings>
            }
          />
          <Tile
            on={beat === 3}
            title="Its own status"
            sub={track}
            art={
              <span className="bx-orbs is-3" aria-hidden="true">
                {ORDER.map((p, i) => (
                  <span key={p} className="bx-orb">
                    <AppIcon brand={p} size={26} />
                    <span className={cn("bx-st", states[i].tone !== "idle" && states[i].tone)} />
                  </span>
                ))}
              </span>
            }
          />
          <div className={cn("bx-tile bx-wide", beat === 3 && "is-on")}>
            <div className="bx-art">
              <div className="flex flex-col items-center">
                <div className="bx-msg">
                  <span className="bx-msg-av" aria-hidden="true">
                    <AppIcon brand="x" size={22} />
                  </span>
                  <div className="min-w-0">
                    <b>X Post</b>
                    <p key={x.note} className="bx-word">{x.note}</p>
                  </div>
                </div>
                {x.tone === "fail" ? (
                  <button type="button" className="bx-btn" onClick={() => setRetry("running")}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry X
                  </button>
                ) : (
                  <span className="bx-btn invisible" aria-hidden="true">
                    Retry X
                  </span>
                )}
              </div>
            </div>
            <div className="bx-copy">
              <h3 className="bx-title">Fix just the one</h3>
              <p className="bx-sub">Retry one place. Nothing else is sent twice.</p>
            </div>
          </div>
        </div>

        <div className="bx-col">
          <div className="bx-tile bx-lime">
            <div className="flex items-center justify-between">
              <Steps beat={beat} go={go} uid={uid} />
              <button type="button" className="bx-play" onClick={() => setPaused((v) => !v)} aria-label={paused ? "Play demo" : "Pause demo"}>
                {paused ? <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" /> : <Pause className="h-4 w-4 fill-current" aria-hidden="true" />}
              </button>
            </div>
            <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${beat}`} aria-live="polite" className="bx-copy mt-auto pt-8">
              <p className="text-[13px] font-semibold">
                Step <span className="tabular">{beat + 1}</span> of 4 · {BEATS[beat].label}
              </p>
              <p key={`w-${beat}-${done}`} className="bx-word bx-big mt-2">
                {w1} <span className="accent-serif font-normal">{w2}</span>
              </p>
              <p key={`c-${beat}`} className="bx-word bx-sub">{BEATS[beat].caption}</p>
            </div>
          </div>
          <div className={cn("bx-tile bx-wide bx-row-sm", beat === 3 && "is-on")}>
            <div className="bx-art">
              <Graph id={`${uid}-graph`} at={beat < 3 ? beat : 2 + done} lit={(beat < 3 ? beat : 2 + done) / 5} />
            </div>
            <div className="bx-copy">
              <h3 className="bx-title">
                Live right now <span className="tabular">{done}/3</span>
              </h3>
              <p className="bx-sub">Each place counts the moment it is live.</p>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

function Tile({ on, live, title, sub, art }: { on: boolean; live?: boolean; title: string; sub: string; art: React.ReactNode }) {
  return (
    <div className={cn("bx-tile", on && "is-on", live && "bx-live")}>
      <div className="bx-art">{art}</div>
      <div className="bx-copy">
        <h3 className="bx-title">{title}</h3>
        <p className="bx-sub">{sub}</p>
      </div>
    </div>
  );
}

/** The step dots, a real tablist: roving tabindex, arrow keys, Home and End. */
function Steps({ beat, go, uid }: { beat: Beat; go: (b: Beat) => void; uid: string }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: React.KeyboardEvent) => {
    const to = e.key === "ArrowRight" ? (beat + 1) % 4 : e.key === "ArrowLeft" ? (beat + 3) % 4 : e.key === "Home" ? 0 : e.key === "End" ? 3 : -1;
    if (to < 0) return;
    e.preventDefault();
    go(to as Beat);
    tabs.current[to]?.focus();
  };
  return (
    <div role="tablist" aria-label="Demo steps" className="bx-dots -ml-2" onKeyDown={key}>
      {BEATS.map((b, i) => (
        <button
          key={b.label}
          ref={(el) => {
            tabs.current[i] = el;
          }}
          id={`${uid}-tab-${i}`}
          type="button"
          role="tab"
          aria-selected={beat === i}
          aria-controls={`${uid}-panel`}
          aria-label={`Step ${i + 1}: ${b.label}`}
          tabIndex={beat === i ? 0 : -1}
          className="bx-dot"
          onClick={() => go(i as Beat)}
        >
          <i />
        </button>
      ))}
    </div>
  );
}
