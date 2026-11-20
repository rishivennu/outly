import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { addNote } from "@/lib/partners/admin";

export const dynamic = "force-dynamic";

const Body = z.object({ body: z.string().trim().min(1, "Write the note first.").max(4000) });

/** Internal only: notes are never emailed and never shown on a creator page. */
export const POST = adminRoute<{ params: { id: string } }>("partners", async (req, { params, admin }) => {
  const b = Body.parse(await req.json());
  const note = await addNote(params.id.slice(0, 40), b.body, { login: admin.login, role: admin.role });
  return json({ note });
}, [30, 60_000]);
