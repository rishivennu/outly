"use client";
import { adminApi } from "@/lib/client/admin-api";

/** Every call the subscriptions admin makes for the policy and the cost rates, in one place. */

export type GridRow = { plan: string; planName: string; currency: string; interval: "month" | "year"; tier: "intro" | "standard"; priceMinor: number | null; floorMinor: number; margin: number | null; ok: boolean };
export type FieldError = { field: string; message: string };
export type NumField = { path: string; label: string; value: number };
export type PolicyForm = {
  intro: Record<string, Record<string, number>>;
  graceDays: number;
  trialDays: number;
  budgetMode: "off" | "alert" | "enforce";
  refundWindowDays: number;
  risk: NumField[];
};
export type Preview = { activeSubs: number; legacy: number; founding: number; trialsActive: number; changes: string[] };
export type PolicyState = {
  enabled: boolean;
  version: string;
  targetMargin: number;
  form: PolicyForm;
  plans: { slug: string; name: string }[];
  currencies: string[];
  grid: GridRow[];
  errors: FieldError[];
  prev: { at: string; by: string; version: string; enabled: boolean } | null;
};
export type EconState = { fields: NumField[]; errors: FieldError[] };

const P = "/api/admin/subscriptions/policy";
const E = "/api/admin/subscriptions/economics";

export const errorsOf = (e: unknown): FieldError[] => ((e as { data?: { errors?: FieldError[] } })?.data?.errors ?? []).filter((x) => x && typeof x.field === "string");

export const policyApi = {
  load: () => adminApi<PolicyState>(P),
  check: (form: PolicyForm) => adminApi<{ grid: GridRow[]; errors: FieldError[] }>(P, { method: "POST", json: { action: "check", form } }),
  save: (form: PolicyForm) => adminApi<PolicyState>(P, { method: "PUT", json: { form } }),
  preview: () => adminApi<Preview>(P, { method: "POST", json: { action: "preview" } }),
  run: (action: "enable" | "disable" | "undo") => adminApi<PolicyState>(P, { method: "POST", json: { action } }),
};

export const econApi = {
  load: () => adminApi<EconState>(`${E}?rates=1`),
  save: (values: Record<string, number>) => adminApi<EconState>(E, { method: "PUT", json: { values } }),
};
