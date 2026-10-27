/** Team roles. Pure, so the rules are unit-tested and readable in one place. */
export const TEAM_ROLES = ["editor", "manager"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export type WorkspaceRole = "owner" | TeamRole;

export const WS_COOKIE = "ol_ws";

export const ROLE_INFO: Record<TeamRole, { label: string; blurb: string }> = {
  editor: { label: "Editor", blurb: "Uploads videos and writes drafts. Can't publish; sends a review link or asks a manager." },
  manager: { label: "Manager", blurb: "Everything an editor does, plus publishing and scheduling." },
};

/** Paths members never reach in someone else's workspace: money, connected accounts, the owner's profile, the team itself. */
const OWNER_ONLY = ["/api/billing", "/api/settings", "/api/accounts", "/api/team/members"];
/** Always open: moving between workspaces and leaving must work from inside one. */
const ALWAYS = ["/api/team/switch", "/api/team/accept", "/api/team/leave", "/api/auth"];

/** null = allowed; otherwise the human reason it isn't. */
export function memberBlock(role: WorkspaceRole, method: string, path: string): string | null {
  if (role === "owner") return null;
  if (ALWAYS.some((p) => path === p || path.startsWith(p + "/"))) return null;
  if (OWNER_ONLY.some((p) => path === p || path.startsWith(p + "/"))) return "Only the workspace owner can change this.";
  const write = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (role === "editor" && write) {
    if (/^\/api\/posts\/[^/]+\/launch$/.test(path)) return "Editors can't publish. Send a review link, or ask the owner or a manager to launch it.";
    if (/^\/api\/posts\/[^/]+$/.test(path) && method.toUpperCase() === "DELETE") return "Editors can't delete posts.";
    if (/^\/api\/targets\/[^/]+\/remove$/.test(path)) return "Editors can't take posts down from a platform. Ask the owner or a manager.";
    // Direct messages speak for the brand in private (1031): editors can read them, managers and the owner answer.
    if (/^\/api\/messages\/[^/]+$/.test(path)) return "Editors can't send direct messages. Ask the owner or a manager to reply.";
  }
  return null;
}

/** Pages a member shouldn't land on in someone else's workspace. */
export const OWNER_PAGES = ["/billing", "/accounts"];
