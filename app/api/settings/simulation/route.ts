import { cookies } from "next/headers";
import { z } from "zod";
import { json, route } from "@/lib/http";

const schema = z.object({ mode: z.enum(["realistic", "smooth", "instagram-reconnect", "youtube-flaky", "x-rejects"]) });

export const POST = route(async (req) => {
  const { mode } = schema.parse(await req.json());
  cookies().set("studio_sim", mode, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return json({ mode });
});
