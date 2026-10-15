/** Client-safe: shared by the admin sidebar and the server guards. */
export type AdminRole = "super" | "finance" | "support";
export type AdminArea = "overview" | "users" | "insights" | "payments" | "pricing" | "tickets" | "faq" | "integrations" | "outbox" | "team" | "site" | "platforms";

export const ROLE_LABEL: Record<AdminRole, string> = { super: "Super admin", finance: "Finance", support: "Support" };
export const ROLE_BLURB: Record<AdminRole, string> = {
  super: "Everything, including integrations and the team.",
  finance: "Revenue, payments, invoices and pricing.",
  support: "Tickets, FAQ, users and the email outbox.",
};

const ACCESS: Record<AdminArea, AdminRole[]> = {
  overview: ["super", "finance", "support"],
  users: ["super", "support", "finance"],
  insights: ["super", "support", "finance"],
  payments: ["super", "finance"],
  pricing: ["super", "finance"],
  tickets: ["super", "support"],
  faq: ["super", "support"],
  outbox: ["super", "support", "finance"],
  integrations: ["super"],
  team: ["super"],
  site: ["super"],
  platforms: ["super"],
};

export const can = (role: AdminRole | undefined | null, area: AdminArea) => !!role && ACCESS[area].includes(role);
