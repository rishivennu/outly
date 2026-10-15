import { AuthCard } from "@/components/auth/AuthCard";

/**
 * Sign in and sign up share one floating card (components/auth/AuthCard). The layout persists between
 * the two routes, so only the form swaps and the light glides to a new spot.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthCard>{children}</AuthCard>;
}
