import { sameSitePath } from "@/lib/safe-next";

/**
 * Sign in with Apple (1153): a plain link like the Google button, so it works before JavaScript loads. Apple's
 * rules for a custom button: the Apple logo and the title in one colour, black on light pages and white on dark
 * ones, at least as prominent as the other sign-in buttons. Same height, radius and press feedback as Google.
 */
export function AppleButton({ from, next, label = "Continue with Apple", remember, onClick }: { from: "login" | "signup"; next?: string | null; label?: string; remember?: boolean; onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const q = new URLSearchParams({ from });
  if (remember !== undefined) q.set("remember", remember ? "1" : "0");
  const safe = sameSitePath(next);
  if (safe) q.set("next", safe);
  return (
    <a
      href={`/api/auth/apple?${q}`}
      onClick={onClick}
      className="apple-btn flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full bg-black px-5 text-[15px] font-semibold text-white transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-px hover:bg-black/85 hover:shadow-[0_10px_24px_-16px_rgb(0_0_0/0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-colors dark:bg-white dark:text-black dark:hover:bg-white/90"
    >
      <svg viewBox="0 0 24 24" className="-mt-0.5 h-[19px] w-[19px]" fill="currentColor" aria-hidden="true">
        <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
      </svg>
      {label}
    </a>
  );
}
