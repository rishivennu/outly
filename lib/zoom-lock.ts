/*
 * R1290: no pinch zoom inside the app. The web pages keep zoom (1192, WCAG 1.4.4), but two places are an app, not a
 * page, and there a stray pinch only breaks the layout: Outlly opened from the Home Screen (standalone, fullscreen or
 * minimal-ui display mode, iOS navigator.standalone, or the Android app marked by appScript) and the admin console.
 * The head script runs before first paint, right after appScript: it marks <html data-zoom="lock"> (CSS turns off
 * pinch via touch-action) and rewrites the viewport meta so iOS Home Screen apps and Android honour it too.
 * Double tap was already off everywhere (html { touch-action: manipulation }).
 */
export const ZOOM_LOCK_CONTENT = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

/** Admin pages lock zoom from the server too (their own viewport export), so the first paint never allows it. */
export const ADMIN_VIEWPORT = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" } as const;

export function zoomLocked(o: { installed: boolean; admin: boolean }): boolean {
  return o.installed || o.admin;
}

export const zoomLockScript = `try{var d=document.documentElement,w=window.matchMedia,i=!!(w&&(w("(display-mode: standalone)").matches||w("(display-mode: fullscreen)").matches||w("(display-mode: minimal-ui)").matches))||navigator.standalone===true||d.getAttribute("data-app")==="android"||d.getAttribute("data-shell")==="native",a=/^\\/admin(\\/|$)/.test(location.pathname);if(i||a){d.setAttribute("data-zoom","lock");var f=function(){var m=document.querySelector('meta[name="viewport"]');if(m)m.setAttribute("content","${ZOOM_LOCK_CONTENT}")};f();document.addEventListener("DOMContentLoaded",f)}}catch(e){}`;
