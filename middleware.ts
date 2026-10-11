import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const AUTH_PAGES = ["/login", "/signup"];
// Marketing pages anyone can read.
const OPEN = ["/", "/privacy", "/terms", "/contact"];
// A review link is its own credential: the reviewer has no account here.
const OPEN_PREFIX = ["/review/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("studio_session")?.value;
  let authed = false;
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET ?? ""), { algorithms: ["HS256"] });
      authed = true;
    } catch {
      authed = false;
    }
  }
  if (OPEN.includes(pathname) || OPEN_PREFIX.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!authed && !AUTH_PAGES.includes(pathname)) {
    const u = new URL("/login", req.url);
    u.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(u);
  }
  if (authed && AUTH_PAGES.includes(pathname)) return NextResponse.redirect(new URL("/home", req.url));
  return NextResponse.next();
}

export const config = {
  // Pages only. API routes do their own auth and return JSON 401s.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|ico|txt|xml)$).*)"],
};
