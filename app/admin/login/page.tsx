import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/auth";
import { AdminLoginForm } from "@/components/admin/LoginForm";
import { OutlyLogo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function AdminLogin({ searchParams }: { searchParams: { next?: string } }) {
  if (await getAdmin()) redirect("/admin");
  const next = searchParams.next?.startsWith("/admin") ? searchParams.next : "/admin";
  return (
    <main id="main" className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="admin-blob absolute -left-24 top-[12%] h-[42vmax] w-[42vmax] rounded-full bg-lime/25 blur-[90px]" />
        <div className="admin-blob absolute -right-32 bottom-[-10%] h-[38vmax] w-[38vmax] rounded-full bg-[#22f04a]/15 blur-[100px] [animation-delay:-6s]" />
      </div>
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex justify-center text-[20px]">
          <OutlyLogo size={34} />
        </div>
        <AdminLoginForm next={next} />
        <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
          This is the Outlly team console. Looking for your creator account? <a className="font-medium text-foreground underline underline-offset-4" href="/login">Sign in here</a>.
        </p>
      </div>
    </main>
  );
}
