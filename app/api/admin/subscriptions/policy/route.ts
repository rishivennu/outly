import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { checkForm, policyState, previewEnable, runPolicyAction, saveForm, withFieldErrors } from "../_lib/policy-admin";

export const dynamic = "force-dynamic";

export const GET = adminRoute("pricing", async () => json(await policyState()));

const Num = z.object({ path: z.string().min(1).max(80), label: z.string().max(120), value: z.number().finite() });
const Form = z.object({
  intro: z.record(z.string().max(40), z.record(z.string().max(3), z.number().int().min(0).max(100_000_000))),
  graceDays: z.number().int().min(0).max(30),
  trialDays: z.number().int().min(0).max(7),
  budgetMode: z.enum(["off", "alert", "enforce"]),
  refundWindowDays: z.number().int().min(0).max(365),
  risk: z.array(Num).max(40),
});

/** Saves the edited policy. Refused (400 with field errors) if any price would fall below its margin floor. */
export const PUT = adminRoute("pricing", async (req, { admin }) => {
  const { form } = z.object({ form: Form }).parse(await req.json());
  return withFieldErrors(async () => json(await saveForm(form, admin)));
}, [30, 60_000]);

const Post = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), form: Form }),
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("disable") }),
  z.object({ action: z.literal("undo") }),
]);

/** check: live margin grid for a draft (no write). preview: what enabling changes. enable / disable / undo: audited writes. */
export const POST = adminRoute("pricing", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  if (b.action === "check") return json(await checkForm(b.form));
  if (b.action === "preview") return json(await previewEnable());
  return withFieldErrors(async () => json(await runPolicyAction(b.action, admin)));
}, [120, 60_000]);
