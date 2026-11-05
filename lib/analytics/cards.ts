/**
 * 1140: the shape of "Your accounts right now". Types only, in their own file, so the client tiles and the
 * route that fills them share one definition without a client bundle reaching into a server route.
 */
import type { Platform } from "../domain";
import type { PlatformDashboard } from "../live/types";

export interface AccountCard {
  accountId: string;
  platform: Platform;
  username: string;
  displayName: string | null;
  avatar: string | null;
  /** connected | needs_reconnect: what the account row says, which decides Connect or Reconnect. */
  status: string;
  practice: boolean;
  /** When the background sync last stored numbers for this account. Null = never, and it says so. */
  lastSyncAt: string | null;
  lastError: string | null;
  /** Exactly what the platform answered, minus its post list (the page has its own standouts). */
  dash: PlatformDashboard | null;
}

export interface PlatformSlot {
  platform: Platform;
  status: string;
  message: string | null;
  connect: { oauth: boolean; token: boolean } | null;
}

export interface AccountsAnswer {
  accounts: AccountCard[];
  slots: PlatformSlot[];
  fetchedAt: string;
}
