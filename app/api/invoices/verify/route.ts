import { z } from "zod";
import { json, route } from "@/lib/http";
import { verifyInvoice } from "@/lib/billing/invoice-verify";

const Body = z.object({ number: z.string().max(40), code: z.string().max(40) });

/** 1121: public invoice check for /verify-invoice. Tight limit per IP: 10 tries per 10 minutes. */
export const POST = route(
  async (req) => {
    const b = Body.parse(await req.json());
    return json(await verifyInvoice(b.number, b.code), { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [10, 10 * 60_000] },
);
