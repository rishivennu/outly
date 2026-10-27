"use client";
import { useSyncExternalStore } from "react";
import { isApp } from "@/lib/app-mode";
import { isNative, nativeCall } from "./native";

const noop = () => () => {};

/** False on the server and during hydration, then true inside the Android app. */
export function useAppMode() {
  return useSyncExternalStore(noop, isApp, () => false);
}

let back = false;

/** Called right before a Back navigation (our Back buttons, the Android back gesture) so the next screen pops in from the left. */
export function markBack() {
  back = true;
}

export function consumeBack() {
  const b = back;
  back = false;
  return b;
}

export const APP_MORE_EVENT = "outlly:app-more";

/** A light tap for small controls, a firmer one for switches and the + button. Real haptics in the native app. */
export function haptic(ms = 8) {
  if (isNative()) {
    void nativeCall("Haptics", "impact", { style: ms >= 12 ? "MEDIUM" : "LIGHT" }).catch(() => {});
    return;
  }
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* some WebViews throw without a user gesture */
  }
}
