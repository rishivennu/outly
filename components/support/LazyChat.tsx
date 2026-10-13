"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const ChatWidget = dynamic(() => import("./ChatWidget").then((m) => m.ChatWidget), { ssr: false });

/**
 * Pip loads after the page is idle, so its code (chat, help copy in 12 languages, the mascot)
 * never competes with the first paint. The bubble appears a moment later; nothing shifts.
 */
export function LazyChat() {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<{ q?: string } | null>(null);
  useEffect(() => {
    const go = () => setReady(true);
    const open = (e: Event) => {
      const q = (e as CustomEvent<string | undefined>).detail;
      setPending({ q: typeof q === "string" ? q : undefined });
      go();
    };
    window.addEventListener("outly:chat-open", open, { once: true });
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 2500 }) : window.setTimeout(go, 1200);
    return () => {
      window.removeEventListener("outly:chat-open", open);
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, []);
  return ready ? <ChatWidget pending={pending} /> : null;
}
