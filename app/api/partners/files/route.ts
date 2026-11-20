import type { NextRequest } from "next/server";
import { assertSameOrigin, clientIp, HttpError, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";
import { PARTNER_FILE_MAX_BYTES } from "@/lib/partners/types";
import { cleanFileName, FILE_EXT, makeFileToken, pendingFileKey, sniffMime } from "@/lib/partners/core";

const TOO_BIG = "That file is over 8 MB. Export a smaller screenshot or PDF and try again.";

/** One analytics file per request, stored under partners/pending/<token> until the application that names it is sent. */
export const POST = route(
  async (req: NextRequest) => {
    assertSameOrigin(req);
    if (!rateLimit("partners:files:" + clientIp(req), 30, 3_600_000).ok)
      throw new HttpError(429, "You have uploaded a lot of files in the last hour. Please try again later.", "RATE_LIMITED");
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > PARTNER_FILE_MAX_BYTES + 64 * 1024) throw new HttpError(413, TOO_BIG, "TOO_LARGE");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "Choose a file to upload.", "NO_FILE");
    if (file.size > PARTNER_FILE_MAX_BYTES) throw new HttpError(413, TOO_BIG, "TOO_LARGE");
    if (file.size === 0) throw new HttpError(400, "That file is empty. Choose another one.", "EMPTY");
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = sniffMime(buf);
    if (!mime) throw new HttpError(415, "Upload a PNG, JPG or PDF file.", "BAD_TYPE");
    const token = makeFileToken();
    await storage.put(pendingFileKey(token, FILE_EXT[mime]), buf, mime, PARTNER_FILE_MAX_BYTES);
    return json({ token, name: cleanFileName(file.name), size: buf.length, mime });
  },
  { auth: false, limit: [40, 3_600_000] },
);
