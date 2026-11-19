import { NotFoundScreen } from "@/components/shared/NotFoundScreen";

export const metadata = { title: "Page not found" };

// R1224: one client reference, so the not-found tree Next ships with every page no longer drags other routes' JS along.
export default function NotFound() {
  return <NotFoundScreen />;
}
