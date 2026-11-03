import { statusBarColor } from "./colors";

/*
 * 1108: one place that makes the phone's status bar match the page that is on screen now.
 * - meta theme-color (Safari, Android Chrome, installed web apps) gets the exact page background of the theme and
 *   surface (html[data-tc] is what the head script's observer holds every tag to, lib/theme/script.ts).
 * - Inside the Android app (Capacitor 8, edge to edge: the page itself is drawn behind the bars) the bar icons switch
 *   between light (dark theme) and dark (light theme), so they stay readable on the page colour.
 */
type Cap = { isNativePlatform?: () => boolean; nativePromise?: (p: string, m: string, o: unknown) => Promise<unknown> };
let lastStyle = "";

export function syncStatusBar(dark = document.documentElement.classList.contains("dark")) {
  const el = document.documentElement;
  const color = statusBarColor(dark, document.querySelector(".sky-host") ? "sky" : "app");
  if (el.dataset.tc !== color) el.dataset.tc = color;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (m.getAttribute("content") !== color) m.setAttribute("content", color);
  });
  const cap = (window as unknown as { Capacitor?: Cap }).Capacitor;
  const style = dark ? "DARK" : "LIGHT";
  if (style !== lastStyle && cap?.isNativePlatform?.() && cap.nativePromise) {
    lastStyle = style;
    cap.nativePromise("SystemBars", "setStyle", { style }).catch(() => (lastStyle = ""));
  }
  return color;
}

/** An iPhone Home Screen app (navigator.standalone): it only takes the status bar colour from a page as it loads. */
export function isIosHomeScreenApp() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
