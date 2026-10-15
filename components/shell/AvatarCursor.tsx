"use client";
import { useEffect, useRef, useState } from "react";
import { OrbArt } from "@/components/brand/OrbAvatar";
import { useUser } from "@/components/shell/UserContext";
import { defaultOrb, resolveAvatar } from "@/lib/avatar";

/**
 * Avatar cursor (10-15): the mouse pointer becomes a small arrow with your avatar riding beside it.
 * On clickable things the avatar gets a lime ring; text fields keep the normal text cursor, so
 * typing and selecting still feel native. Mouse and trackpad only (touch has no cursor), and the
 * system cursor comes back under forced colours. On by default; Settings > Look turns it off
 * (saved per device).
 */
const KEY = "outly-avatar-cursor";
const EVT = "outly-avatar-cursor";

export function cursorEnabled() {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}
export function setCursorEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

const ARROW = `<path d="M3 2v17.5l4.6-4.1 3.1 7.1 3.3-1.4-3-6.9h6.3z" fill="#15131a" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>`;
const wrap = (inner: string, hover: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40" viewBox="0 0 40 40">` +
  (hover ? `<circle cx="26.5" cy="26.5" r="13" fill="none" stroke="#c6f432" stroke-width="2.6"/>` : "") +
  inner + ARROW + `</svg>`;
const css = (svg: string) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}") 3 2, auto`;

async function photoData(src: string): Promise<string | null> {
  try {
    const r = await fetch(src, { mode: "cors", referrerPolicy: "no-referrer" });
    if (!r.ok) return null;
    const b = await r.blob();
    if (b.size > 400_000) return null;
    return await new Promise((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => ok(null);
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

export function AvatarCursor() {
  const user = useUser();
  const seed = user.email || user.id;
  const r = resolveAvatar(user.avatar, seed);
  const orb = "orb" in r ? r.orb : defaultOrb(seed);
  const photo = "photo" in r ? r.photo : null;
  const art = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(cursorEnabled());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.removeAttribute("data-avatar-cursor");
      root.style.removeProperty("--avatar-cursor");
      root.style.removeProperty("--avatar-cursor-hover");
    };
    if (!on || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return clear;
    let dead = false;

    const orbInner = (size: number, at: number) => {
      const svg = art.current?.querySelector("svg");
      if (!svg) return "";
      const c = svg.cloneNode(true) as SVGSVGElement;
      c.removeAttribute("class");
      c.setAttribute("x", String(at));
      c.setAttribute("y", String(at));
      c.setAttribute("width", String(size));
      c.setAttribute("height", String(size));
      return new XMLSerializer().serializeToString(c);
    };
    const photoInner = (data: string, size: number, at: number) => {
      const cx = at + size / 2;
      return `<defs><clipPath id="ac"><circle cx="${cx}" cy="${cx}" r="${size / 2}"/></clipPath></defs>` +
        `<image href="${data}" xlink:href="${data}" x="${at}" y="${at}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ac)"/>` +
        `<circle cx="${cx}" cy="${cx}" r="${size / 2}" fill="none" stroke="#fff" stroke-width="1.6"/>`;
    };
    const apply = (normal: string, hover: string) => {
      if (dead || !normal) return;
      root.style.setProperty("--avatar-cursor", css(wrap(normal, false)));
      root.style.setProperty("--avatar-cursor-hover", css(wrap(hover, true)));
      root.setAttribute("data-avatar-cursor", "");
    };

    apply(orbInner(24, 14), orbInner(22, 15.5));
    if (photo)
      void photoData(photo).then((d) => {
        if (d) apply(photoInner(d, 22, 15), photoInner(d, 20, 16.5));
      });
    return () => {
      dead = true;
      clear();
    };
  }, [on, photo, orb.color, orb.face]);

  return (
    <div ref={art} aria-hidden="true" style={{ position: "fixed", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}>
      <OrbArt orb={orb} size={24} />
    </div>
  );
}

/** Settings switch for the avatar cursor. */
export function CursorToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(cursorEnabled()), []);
  return (
    <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl p-3 pl-4 hairline">
      <div className="min-w-0">
        <p className="text-sm font-semibold" id="ac-l">Avatar cursor</p>
        <p className="text-[13px] text-muted-foreground" id="ac-d">Your avatar follows the mouse pointer. Text fields keep the normal cursor.</p>
      </div>
      <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          aria-labelledby="ac-l"
          aria-describedby="ac-d"
          onChange={(e) => {
            setOn(e.target.checked);
            setCursorEnabled(e.target.checked);
          }}
          className="peer sr-only"
        />
        <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}
