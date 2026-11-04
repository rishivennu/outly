import { json, route } from "@/lib/http";
import { duplicatePost } from "@/lib/posts/duplicate";

export const POST = route(async (_req, { user, params }) => json({ post: await duplicatePost(user.id, params.id) }, { status: 201 }));
