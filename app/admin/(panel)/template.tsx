import { RouteStage } from "@/components/shared/RouteStage";

/**
 * Every admin route renders into the shared route stage (1065, lib/motion/route.ts): a new section opens
 * through a short sideways mask, a ticket pushes in, and filters, search, pagination and Refresh (query
 * changes and router.refresh) never replay it. Kept short: this is a working console. Reduced motion: a fade.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <RouteStage base="/admin">{children}</RouteStage>;
}
