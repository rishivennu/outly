"use client";
import { createContext, useContext } from "react";

/** Is the beta switch on (admin → Beta program)? Set once by the marketing layout. Off outside it. */
const Ctx = createContext(false);
export const BetaProvider = ({ value, children }: { value: boolean; children: React.ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useBeta = () => useContext(Ctx);
