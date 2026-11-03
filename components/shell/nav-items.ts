import { BarChart3, CalendarDays, ClipboardCheck, CreditCard, Globe, Home, LayoutGrid, LifeBuoy, Link2, MessagesSquare, Plus, Settings, ShieldCheck, SlidersHorizontal, UserRound, type LucideIcon } from "lucide-react";

/**
 * Navigation data shared by the classic sidebar, the pulse rail (1100), the phone tab bar and the account
 * menus, so a section is added or renamed in one place.
 */
export type NavItem = { href: string; label: string; icon: LucideIcon };

export const MAIN: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/content", label: "Content", icon: LayoutGrid },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/inbox", label: "Inbox", icon: MessagesSquare },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
];

/** The sidebar's Workspace group. Teammates never see the owner's accounts or billing. */
export function workspaceItems(teammate: boolean): NavItem[] {
  return [
    ...(teammate ? [] : [
      { href: "/accounts", label: "Connected accounts", icon: Link2 },
      { href: "/billing", label: "Billing", icon: CreditCard },
    ]),
    { href: "/support", label: "Help centre", icon: LifeBuoy },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
}

/**
 * The account menu (1100): desktop dropdown on the rail's profile and the phone drawer. Settings deep links
 * open the right category (?tab=, read on the server so there is no flash of Profile).
 */
export function accountItems(teammate: boolean): { account: NavItem[]; more: (NavItem & { external?: boolean })[] } {
  return {
    account: [
      { href: "/settings?tab=profile", label: "My profile", icon: UserRound },
      { href: "/settings?tab=security", label: "Account settings", icon: ShieldCheck },
      { href: "/settings?tab=personalization", label: "Preferences", icon: SlidersHorizontal },
    ],
    more: [
      ...(teammate ? [] : [{ href: "/billing", label: "Billing & Subscription", icon: CreditCard }]),
      { href: "/support", label: "Help & Support", icon: LifeBuoy },
      { href: "/", label: "Outlly website", icon: Globe, external: true },
    ],
  };
}

/** Animated-icon names for the pulse shell (1080), by route. */
export const ANIM: Record<string, string> = { "/home": "home", "/create": "plus", "/content": "content", "/calendar": "calendar", "/analytics": "analytics", "/inbox": "inbox", "/approvals": "approvals", "/accounts": "accounts", "/billing": "billing", "/support": "help", "/settings": "settings", "/": "website" };

export const TOUR: Record<string, string> = { "/home": "home", "/billing": "billing", "/support": "support", "/settings": "settings", "/create": "new-post", "/content": "content", "/calendar": "calendar", "/analytics": "analytics", "/inbox": "inbox", "/approvals": "approvals", "/accounts": "accounts" };

/** Exact route or one of its children: "/create" is active on "/create/bulk", never on "/creator". Query ignored. */
export function isActive(path: string | null, href: string) {
  if (!path) return false;
  const h = href.split("?")[0]!;
  return path === h || path.startsWith(`${h}/`);
}

/**
 * The phone top bar's title (1105): the section you are in, short enough to sit centred between the logo and the
 * two buttons on a 320px phone. Children use their section's ("/analytics/instagram" is Analytics).
 */
const TITLES: [string, string][] = [
  ["/home", "Home"], ["/create", "Create"], ["/content", "Content"], ["/calendar", "Calendar"], ["/analytics", "Analytics"],
  ["/inbox", "Inbox"], ["/approvals", "Approvals"], ["/accounts", "Accounts"], ["/billing", "Billing"], ["/support", "Help"],
  ["/settings", "Settings"],
];
export function pageTitle(path: string | null) {
  return TITLES.find(([h]) => isActive(path, h))?.[1] ?? "";
}

/** The pulse shell's selection glides on a time-based curve (no spring overshoot). */
export const GLIDE = { type: "tween", duration: 0.35, ease: [0.16, 1, 0.3, 1] } as const;

export { RAIL_KEY, railScript } from "@/lib/rail";
