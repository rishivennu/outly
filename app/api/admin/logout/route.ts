import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, json } from "@/lib/http";
import { destroyAdminSession } from "@/lib/admin/auth";

/** Works from a plain <form method="post"> (303 back to sign in) and from fetch. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
  } catch {
    return json({ error: "Blocked." }, { status: 403 });
  }
  destroyAdminSession();
  return NextResponse.redirect(new URL("/admin/login", req.url), 303);
}
