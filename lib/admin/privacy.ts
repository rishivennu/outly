import { maskEmail } from "@/lib/referral-core";
import type { AdminRole } from "@/lib/admin/perms";

/**
 * 1163: personal details on admin reports. Lists of people (delivery logs, most engaged, failures) show a masked
 * address unless the admin is a super admin; the mask is applied on the server, so a support or marketing
 * session never receives the full address in the page payload.
 */
export const canSeeEmail = (role: AdminRole) => role === "super";
export const adminEmail = (email: string | null | undefined, role: AdminRole) => (!email ? "" : canSeeEmail(role) ? email : maskEmail(email));
