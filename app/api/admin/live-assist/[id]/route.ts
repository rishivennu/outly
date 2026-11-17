import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { accept, addNote, agentSend, agentTyping, assign, detail, reopenSession, resolve, returnToPip, setCategory, setPriority, takeover } from "@/lib/support/live";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };
type Ctx = { params: { id: string } };

/** One chat: messages (all recent on first open, then ?after=N), notes, history and customer context. */
export const GET = adminRoute<Ctx>("live", async (req, { admin, params }) => {
  const p = req.nextUrl.searchParams;
  const after = p.get("after");
  const out = await detail(admin, params.id.slice(0, 40), { after: after == null || after === "" ? null : Number(after), read: p.get("read") === "1" });
  return json(out, { headers: NO_STORE });
}, [300, 60_000]);

const Text = z.string().max(4000);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("takeover") }),
  z.object({ action: z.literal("assign"), to: z.string().min(1).max(40) }),
  z.object({ action: z.literal("transfer"), to: z.string().min(1).max(40) }),
  z.object({ action: z.literal("send"), text: Text, cid: z.string().max(40).optional() }),
  z.object({ action: z.literal("typing") }),
  z.object({ action: z.literal("note"), body: Text }),
  z.object({ action: z.literal("priority"), priority: z.string().max(20) }),
  z.object({ action: z.literal("category"), category: z.string().max(20) }),
  z.object({ action: z.literal("return") }),
  z.object({ action: z.literal("resolve"), confirm: z.literal(true) }),
  z.object({ action: z.literal("reopen") }),
]);

/** Every change is a conditional update in lib/support/live.ts: two specialists can never both win the same chat. */
export const POST = adminRoute<Ctx>("live", async (req, { admin, params }) => {
  const b = Body.parse(await req.json());
  const id = params.id.slice(0, 40);
  const h = { headers: NO_STORE };
  switch (b.action) {
    case "accept":
      return json(await accept(admin, id), h);
    case "takeover":
      return json(await takeover(admin, id), h);
    case "assign":
    case "transfer":
      return json(await assign(admin, id, b.to, b.action), h);
    case "send":
      return json(await agentSend(admin, id, { text: b.text, cid: b.cid }), h);
    case "typing":
      return json(await agentTyping(admin, id), h);
    case "note":
      return json(await addNote(admin, id, b.body), h);
    case "priority":
      return json(await setPriority(admin, id, b.priority), h);
    case "category":
      return json(await setCategory(admin, id, b.category), h);
    case "return":
      return json(await returnToPip(admin, id), h);
    case "resolve":
      return json(await resolve(admin, id), h);
    case "reopen":
      return json(await reopenSession(admin, id), h);
  }
}, [300, 60_000]);
