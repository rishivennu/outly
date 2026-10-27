"use client";

/*
 * The Android app (Capacitor) injects window.Capacitor into every page of this site. These helpers talk to
 * it directly, so the website needs no Capacitor package: on the web every call here is a no-op.
 */

type Listener = { remove: () => Promise<void> | void };
interface Bridge {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  nativePromise: <T>(plugin: string, method: string, options?: unknown) => Promise<T>;
  addListener: (plugin: string, event: string, cb: (data: never) => void) => Listener;
  convertFileSrc: (path: string) => string;
}

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  return cap?.isNativePlatform?.() && typeof cap.nativePromise === "function" ? cap : null;
}

export function isNative() {
  return bridge() !== null;
}

export function hasPlugin(name: string) {
  return !!bridge()?.isPluginAvailable?.(name);
}

/** Calls a native plugin method. Rejects on the web, so callers keep a web fallback. */
export function nativeCall<T = void>(plugin: string, method: string, options?: unknown): Promise<T> {
  const b = bridge();
  return b ? b.nativePromise<T>(plugin, method, options ?? {}) : Promise.reject(new Error("not in the app"));
}

export function nativeOn<T>(plugin: string, event: string, cb: (data: T) => void): () => void {
  const b = bridge();
  if (!b) return () => {};
  const l = b.addListener(plugin, event, cb as (data: never) => void);
  return () => void l.remove();
}

export function nativeFileUrl(path: string) {
  return bridge()?.convertFileSrc(path) ?? path;
}

export interface ShellInfo {
  version: string;
  build: number;
  push: boolean;
}

let info: Promise<ShellInfo | null> | null = null;
export function shellInfo() {
  info ??= nativeCall<ShellInfo>("OutllyShell", "info").catch(() => null);
  return info;
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Saves a file the page made itself (an .srt, recovery codes). A WebView ignores <a download> on a blob,
 * so in the app the file goes to Downloads through the shell; on the web it is the usual download link.
 */
export async function saveBlob(blob: Blob, name: string) {
  if (isNative()) {
    await nativeCall("OutllyShell", "saveFile", { name, mime: blob.type || "application/octet-stream", data: toBase64(await blob.arrayBuffer()) });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Opens a page in a Chrome Custom Tab over the app (sign-in and account connects run there). */
export function openInBrowser(url: string) {
  return nativeCall("Browser", "open", { url, toolbarColor: "#0d0d10", presentationStyle: "popover" });
}
