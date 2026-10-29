/** Client-safe: shared by the admin sidebar and the server guards. */
export type AdminRole = "super" | "finance" | "support" | "marketing";
export const ADMIN_ROLES = ["super", "finance", "support", "marketing"] as const satisfies readonly AdminRole[];
export type AdminArea = "overview" | "users" | "insights" | "payments" | "pricing" | "tickets" | "faq" | "integrations" | "outbox" | "team" | "site" | "platforms" | "retention" | "growth" | "plans" | "referrals";

export const ROLE_LABEL: Record<AdminRole, string> = { super: "Super admin", finance: "Finance", support: "Support", marketing: "Marketing lead" };
export const ROLE_BLURB: Record<AdminRole, string> = {
  super: "Everything, including integrations and the team.",
  finance: "Revenue, payments, invoices, pricing, plan grants and referral rewards.",
  support: "Tickets, FAQ, users and the email outbox.",
  marketing: "Growth: signup funnel, lead lists, campaign links, referrals and win-back.",
};

const ACCESS: Record<AdminArea, AdminRole[]> = {
  overview: ["super", "finance", "support", "marketing"],
  users: ["super", "support", "finance"],
  insights: ["super", "support", "finance"],
  payments: ["super", "finance"],
  pricing: ["super", "finance"],
  tickets: ["super", "support"],
  faq: ["super", "support"],
  outbox: ["super", "support", "finance", "marketing"],
  integrations: ["super"],
  team: ["super"],
  site: ["super"],
  platforms: ["super"],
  retention: ["super", "support", "marketing"],
  growth: ["super", "marketing"],
  // Giving someone a paid plan is a money decision: finance and super only.
  plans: ["super", "finance"],
  referrals: ["super", "finance", "marketing"],
};

export const can = (role: AdminRole | undefined | null, area: AdminArea) => !!role && ACCESS[area].includes(role);
