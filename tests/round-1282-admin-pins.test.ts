/** R1282 admin "Creator Partnerships": source pins for the nav, perms, routes, notes privacy and the file route. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { can } from "../lib/admin/perms";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const API = "app/api/admin/partners";
const ROUTES = [`${API}/route.ts`, `${API}/kpis/route.ts`, `${API}/[id]/route.ts`, `${API}/[id]/status/route.ts`, `${API}/[id]/notes/route.ts`, `${API}/[id]/files/[fileId]/route.ts`, `${API}/export/route.ts`];

describe("nav + perms", () => {
  const shell = read("components/admin/AdminShell.tsx");
  test("Creator Partnerships sits right after Refer & Earn in Run", () => {
    const lines = shell.split("\n");
    const i = lines.findIndex((l) => l.includes('href: "/admin/referrals"'));
    expect(lines[i + 1]).toContain('{ href: "/admin/partners", label: "Creator Partnerships", icon: Handshake, area: "partners", group: "Run" }');
    expect(shell).toMatch(/import \{[^}]*\bHandshake\b[^}]*\} from "lucide-react"/);
  });
  test("partners area: super, marketing and finance only", () => {
    expect(can("super", "partners")).toBe(true);
    expect(can("marketing", "partners")).toBe(true);
    expect(can("finance", "partners")).toBe(true);
    expect(can("support", "partners")).toBe(false);
  });
  test("both pages guard with requireAdmin(\"partners\") and are noindex", () => {
    for (const p of ["app/admin/(panel)/partners/page.tsx", "app/admin/(panel)/partners/[id]/page.tsx"]) {
      const s = read(p);
      expect(s).toContain('await requireAdmin("partners")');
      expect(s).toContain("robots: { index: false, follow: false }");
    }
  });
  test("list page copy matches the brief", () => {
    const page = read("app/admin/(panel)/partners/page.tsx");
    expect(page).toContain('title="Creator Partnerships"');
    expect(page).toContain('body="Applications, offers and active creator partnerships."');
    expect(read("components/admin/partners/PartnersPanel.tsx")).toContain("No applications yet. Share outlly.com/partners with creators to get started.");
  });
  test("server pages never import values from client files", () => {
    for (const p of ["app/admin/(panel)/partners/page.tsx", "app/admin/(panel)/partners/[id]/page.tsx", "components/admin/partners/PartnerDetail.tsx", "components/admin/partners/bits.tsx", "components/admin/partners/HistoryList.tsx"]) {
      expect(read(p).startsWith('"use client"')).toBe(false);
    }
    expect(read("app/admin/(panel)/partners/page.tsx")).toContain('import { SORT_OPTS } from "@/components/admin/partners/bits"');
    for (const p of ["PartnersPanel", "ActionBar", "NotesPanel", "AttributionCard"]) expect(read(`components/admin/partners/${p}.tsx`).startsWith('"use client"')).toBe(true);
  });
});

describe("API routes", () => {
  test("every route exists and is wrapped in adminRoute(\"partners\")", () => {
    for (const r of ROUTES) {
      expect(existsSync(join(root, r))).toBe(true);
      const s = read(r);
      const handlers = [...s.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = (\w+)/g)];
      expect(handlers.length).toBeGreaterThan(0);
      for (const h of handlers) expect(h[2]).toBe("adminRoute");
      expect(s.match(/adminRoute(<[^>]*>)?\("partners"/g)?.length).toBe(handlers.length);
    }
  });
  test("status route enforces canTransition and requires a message for more_info and rejected", () => {
    const s = read(`${API}/[id]/status/route.ts`);
    expect(s).toContain("canTransition(app.status, b.to)");
    expect(s).toContain("MESSAGE_REQUIRED.includes(b.to");
    expect(s).toContain("z.enum(PARTNER_STATUSES)");
    const lib = read("lib/partners/admin.ts");
    expect(lib).toContain('export const MESSAGE_REQUIRED: PartnerStatus[] = ["more_info", "rejected"];');
    expect(lib).toContain("if (!canTransition(from, to))");
  });
  test("file route streams with no-store and never hands out a storage URL", () => {
    const s = read(`${API}/[id]/files/[fileId]/route.ts`);
    expect(s).toContain("storage.read(file.key)");
    expect(s).toContain('"Cache-Control": "private, no-store"');
    expect(s).toContain("inline; filename=");
    expect(s).toContain("applicationId: params.id");
    expect(s).not.toContain("signedUrl");
    expect(s).not.toMatch(/Response\.redirect|redirect\(/);
  });
  test("detail page opens attachments through the admin file route only", () => {
    const d = read("components/admin/partners/PartnerDetail.tsx");
    expect(d).toContain("href={`/api/admin/partners/${app.id}/files/${f.id}`}");
    expect(d).not.toContain("signedUrl");
    expect(d).toContain('rel="noopener nofollow noreferrer"');
  });
  test("CSV export neutralises spreadsheet formulas", () => {
    expect(read("lib/partners/admin.ts")).toContain("/^[=+\\-@\\t\\r]/.test(s)");
  });
});

describe("notes stay internal", () => {
  const lib = read("lib/partners/admin.ts");
  test("changeStatus mails only the creator-facing message and link", () => {
    const call = lib.match(/sendPartnerStatusEmail\(([^\n]*)\)/)?.[1] ?? "";
    expect(call).toContain("updated, to as PartnerStatus");
    expect(call).not.toMatch(/note/i);
    const fn = lib.slice(lib.indexOf("export async function changeStatus"), lib.indexOf("export async function addNote"));
    expect(fn).not.toContain("partnerNote");
    expect(fn).not.toContain("notes");
  });
  test("lib/partners/email.ts is never given notes", () => {
    if (!existsSync(join(root, "lib/partners/email.ts"))) return;
    const e = read("lib/partners/email.ts");
    expect(e).not.toContain("partnerNote");
    expect(e).not.toMatch(/notes:\s*true/);
  });
  test("creator-facing code never reads notes", () => {
    for (const p of ["lib/partners/offers.ts", "lib/partners/offer-core.ts"]) {
      if (!existsSync(join(root, p))) continue;
      expect(read(p)).not.toMatch(/partnerNote|notes:\s*true/);
    }
  });
  test("the admin detail API returns the full record (notes included, nothing stripped)", () => {
    const s = read(`${API}/[id]/route.ts`);
    expect(s).toContain('return json({ application: app }, { headers: { "Cache-Control": "private, no-store" } });');
    expect(lib).toContain('notes: { orderBy: { createdAt: "desc" } }');
  });
  test("notes panel says so in plain words", () => {
    expect(read("components/admin/partners/NotesPanel.tsx")).toContain("Internal. Never shown to the creator.");
  });
});

describe("detail UI", () => {
  const bar = read("components/admin/partners/ActionBar.tsx");
  test("actions come from PARTNER_TRANSITIONS and post to the status route", () => {
    expect(bar).toContain("PARTNER_TRANSITIONS[from]");
    expect(bar).toContain("`/api/admin/partners/${id}/status`");
    expect(bar).toContain('message: "required"');
  });
  test("dialogs reuse the focus-trapping ConfirmDialog", () => {
    expect(bar).toContain('import { ConfirmDialog } from "@/components/shared/ConfirmDialog"');
  });
  test("performance figures are labelled creator-provided", () => {
    const d = read("components/admin/partners/PartnerDetail.tsx");
    const perf = d.slice(d.indexOf(">Performance<"), d.indexOf(">Attachments<"));
    const rows = [...perf.matchAll(/\["([^"]+)",/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows) expect(r).toContain("(creator-provided)");
  });
  test("benefits pieces are mounted with the shared props", () => {
    const d = read("components/admin/partners/PartnerDetail.tsx");
    expect(d).toContain("<OfferEditor applicationId={app.id} status={app.status} email={app.email} />");
    expect(d).toContain("<DeliverablesPanel applicationId={app.id} status={app.status} email={app.email} />");
  });
  test("no em-dashes in admin partner copy", () => {
    for (const p of ["ActionBar", "NotesPanel", "HistoryList", "AttributionCard", "PartnerDetail", "PartnersPanel", "bits"]) expect(read(`components/admin/partners/${p}.tsx`)).not.toContain("\u2014");
  });
});
