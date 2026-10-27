import type { NextRequest } from "next/server";

/** Every request from the Outlly app (Flutter) carries this header, e.g. "android/2.0.0+3". */
export const NATIVE_CLIENT_HEADER = "x-outlly-client";

const SHAPE = /^(android|ios)\/(\d{1,3}\.\d{1,3}\.\d{1,3})(?:\+(\d{1,6}))?$/;

export function parseNativeClient(v: string | null | undefined) {
  const m = v ? SHAPE.exec(v.trim()) : null;
  return m ? { platform: m[1] as "android" | "ios", version: m[2], build: m[3] ? Number(m[3]) : null } : null;
}

export const nativeClient = (req: NextRequest) => parseNativeClient(req.headers.get(NATIVE_CLIENT_HEADER));
