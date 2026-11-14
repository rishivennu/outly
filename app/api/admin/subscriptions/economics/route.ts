import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { economicsReport } from "../_lib/report";
import { econState, policyTarget, saveEconValues, withFieldErrors } from "../_lib/policy-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ?rates=1: the editable cost rates. Otherwise the month report (?month=YYYY-MM, UTC, default this month). */
export const GET = adminRoute("pricing", async (req) => {
  const q = req.nextUrl.searchParams;
  if (q.get("rates")) return json(await econState());
  return json(await economicsReport(q.get("month") ?? "", await policyTarget()));
});

const Put = z.object({ values: z.record(z.string().min(1).max(80), z.number().finite().min(0)) });

/** Saves edited cost rates onto subs.economics. Refused with field errors if a live price would drop below its floor. */
export const PUT = adminRoute("pricing", async (req, { admin }) => {
  const { values } = Put.parse(await req.json());
  return withFieldErrors(async () => json(await saveEconValues(values, admin)));
}, [30, 60_000]);
