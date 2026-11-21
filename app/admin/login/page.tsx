import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/auth";
import { AdminLoginForm } from "@/components/admin/LoginForm";
import { AuthCard } from "@/components/auth/AuthCard";
import { cookies } from "next/headers";
import { adminAppMeta } from "@/lib/admin/app-meta";
import { THEME_COOKIE } from "@/lib/theme/colors";
import { ADMIN_VIEWPORT } from "@/lib/zoom-lock";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Admin sign in", robots: { index: false, follow: false }, ...adminAppMeta((await cookies()).get(THEME_COOKIE)?.value) };
}

/** R1290: the console is an app, not a page: no pinch zoom (the web pages keep it, 1192). */
export const viewport: Viewport = { ...ADMIN_VIEWPORT };
/** Admin sign in on the same floating card as creator sign up (10-15e), with team-console copy on the light panel. */
export default async function AdminLogin(props: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await props.searchParams;
  if (await getAdmin()) redirect("/admin");
  // R1207: a path inside /admin, with its query ("/admin/live-assist?s=..."), and never a protocol-relative URL.
  const raw = searchParams.next ?? "";
  const next = raw.startsWith("/admin") && !raw.startsWith("/admin/login") && !raw.includes("//") ? raw : "/admin";
  return (
    <div className="admin-type">
      <AuthCard id="main" eyebrow="Outlly team console" lines={["Keep every post", "moving, quietly"]}>
        <AdminLoginForm next={next} />
      </AuthCard>
    </div>
  );
}
