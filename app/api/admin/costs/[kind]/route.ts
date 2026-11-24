import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { createBill, createBudget, createPrice, createRecurring, sweepCosts } from "@/lib/costs/manual";
import { importBills } from "@/lib/costs/import";

export const dynamic = "force-dynamic";

type Ctx = { params: { kind: string } };

/** R1314 manual entries: POST /api/admin/costs/{bills|recurring|budgets|prices} creates one; POST .../sweep runs the housekeeping now; POST .../import (R1315) previews or commits a CSV of invoices. */
export const POST = adminRoute<Ctx>("costs", async (req, { params, admin }) => {
  const by = { login: admin.login };
  if (params.kind === "sweep") return json({ ok: true, result: await sweepCosts() });
  const body = await req.json();
  if (params.kind === "import") return json(await importBills(body, by)); // its own shape: ok/duplicates/errors counts plus the rows
  const row =
    params.kind === "bills" ? await createBill(body, by)
    : params.kind === "recurring" ? await createRecurring(body, by)
    : params.kind === "budgets" ? await createBudget(body, by)
    : params.kind === "prices" ? await createPrice(body, by)
    : null;
  if (!row) throw new HttpError(404, "Unknown kind", "NOT_FOUND");
  return json({ ok: true, row }, { status: 201 });
}, [30, 60_000]);
