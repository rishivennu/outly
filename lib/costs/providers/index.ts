import "server-only";
import { render } from "./render";
import { supabase } from "./supabase";
import { vercel } from "./vercel";
import type { Adapter } from "./types";

export const ADAPTERS: readonly Adapter[] = [vercel, render, supabase];
export const adapterFor = (provider: string): Adapter | null => ADAPTERS.find((a) => a.provider === provider) ?? null;
export type { Adapter, SyncRange, SyncResult, TestResult } from "./types";
