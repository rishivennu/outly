import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { ackAlert, deleteBill, deleteBudget, deleteRecurring, updateBill, updateBudget, updateRecurring } from "@/lib/costs/manual";

export const dynamic = "force-dynamic";

type Ctx = { params: { kind: string; id: string } };

/** R1314: PATCH edits one manual entry (alerts: acknowledges it); DELETE removes it. */
export const PATCH = adminRoute<Ctx>("costs", async (req, { params, admin }) => {
  const by = { login: admin.login };
  if (params.kind === "alerts") return json({ ok: true, row: await ackAlert(params.id, by) });
  const body = await req.json();
  const row =
    params.kind === "bills" ? await updateBill(params.id, body, by)
    : params.kind === "recurring" ? await updateRecurring(params.id, body, by)
    : params.kind === "budgets" ? await updateBudget(params.id, body, by)
    : null;
  if (!row) throw new HttpError(404, "Unknown kind", "NOT_FOUND");
  return json({ ok: true, row });
}, [30, 60_000]);

export const DELETE = adminRoute<Ctx>("costs", async (_req, { params, admin }) => {
  const by = { login: admin.login };
  if (params.kind === "bills") await deleteBill(params.id, by);
  else if (params.kind === "recurring") await deleteRecurring(params.id, by);
  else if (params.kind === "budgets") await deleteBudget(params.id, by);
  else throw new HttpError(404, "Unknown kind", "NOT_FOUND");
  return json({ ok: true });
}, [30, 60_000]);
