"use client";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { nativeCall, nativeFileUrl } from "@/lib/client/native";
import { BridgeScreen } from "./BridgeScreen";

interface Shared {
  text?: string;
  path?: string;
  name?: string;
  mime?: string;
}

/**
 * Something was shared into the Android app. The video waits in the app's cache; it goes into the same
 * "outly-share" cache the web share target uses (public/sw.js), so Create picks it up the usual way.
 */
export function AppShareBridge() {
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void (async () => {
      const s = await nativeCall<Shared>("OutllyShell", "takeShare").catch(() => ({}) as Shared);
      const to = new URL("/create", location.origin);
      const story = (s.text ?? "").trim().slice(0, 600);
      if (story) to.searchParams.set("text", story);
      if (s.path) {
        try {
          const blob = await (await fetch(nativeFileUrl(s.path))).blob();
          const c = await caches.open("outly-share");
          await c.put("/__shared-media", new Response(blob, { headers: { "content-type": s.mime || blob.type || "video/mp4", "x-name": encodeURIComponent(s.name || "shared-video.mp4") } }));
          to.searchParams.set("shared", "1");
        } catch {
          to.searchParams.set("shared", "missed");
        }
      }
      location.replace(to.pathname + to.search);
    })();
  }, []);
  return <BridgeScreen busy icon={<Loader2 className="h-8 w-8 motion-safe:animate-spin" />} title="Bringing it in" body="Opening New post with what you shared." />;
}
