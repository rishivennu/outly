import { exportUser } from "@/lib/account";
import { route } from "@/lib/http";
import { utcDay } from "@/lib/ai-quota";
import { renderExportPdf } from "@/lib/export-pdf";

export const dynamic = "force-dynamic";

/**
 * Download everything we hold about this creator. A readable PDF by default (1031); `?format=json` gives
 * the exact machine-readable copy (every character, for moving to another service). Secrets are never included.
 */
export const GET = route(
  async (req, { user }) => {
    const data = await exportUser(user.id);
    const name = `outlly-data-${utcDay()}`;
    if (req.nextUrl.searchParams.get("format") === "json") {
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    const pdf = renderExportPdf(data);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}.pdf"`,
        "content-length": String(pdf.length),
        "cache-control": "no-store",
      },
    });
  },
  { limit: [6, 3600_000] },
);
