import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/auth";
import { AdminLoginForm } from "@/components/admin/LoginForm";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

/** Admin sign in on the same floating card as creator sign up (10-15e), with team-console copy on the light panel. */
export default async function AdminLogin({ searchParams }: { searchParams: { next?: string } }) {
  if (await getAdmin()) redirect("/admin");
  const next = searchParams.next?.startsWith("/admin") ? searchParams.next : "/admin";
  return (
    <AuthCard id="main" eyebrow="Outlly team console" lines={["Keep every post", "moving, quietly"]}>
      <AdminLoginForm next={next} />
    </AuthCard>
  );
}
