"use client";
import { createContext, useContext } from "react";
import { CORE_PLATFORMS, type Platform } from "@/lib/domain";

/**
 * Which destinations the studio offers right now: the core three, plus any platform whose app keys an
 * admin has saved (Admin > Social platforms). Provided once by the studio layout so every view agrees.
 */
const Ctx = createContext<readonly Platform[]>(CORE_PLATFORMS);

export function LivePlatformsProvider({ value, children }: { value: readonly Platform[]; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLivePlatforms = () => useContext(Ctx);
