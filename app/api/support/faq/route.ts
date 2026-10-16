import { json, route } from "@/lib/http";
import { listFaq } from "@/lib/support/faq";

/** Every published help question, grouped by category, so Pip can list them inside the chat. Answers stay server-side until asked. */
export const GET = route(async () => {
  const faq = await listFaq();
  const groups = new Map<string, { id: string; question: string }[]>();
  for (const f of faq) {
    const g = groups.get(f.category) ?? [];
    g.push({ id: f.id, question: f.question });
    groups.set(f.category, g);
  }
  return json({ groups: [...groups].map(([category, items]) => ({ category, items })) }, { headers: { "cache-control": "public, max-age=60" } });
}, { auth: false, limit: [60, 60_000] });
