import "server-only";
import { cookies } from "next/headers";
import { db } from "../db";
import { SRC_COOKIE, isSource, resolveSource } from "./core";

/** The campaign the visitor arrived on, if it's one we wrote. */
export function campaignCookie() {
  const v = cookies().get(SRC_COOKIE)?.value;
  return isSource(v) ? v : null;
}

/** Call right after a new account is created (after attachReferral). Credits the channel once, then clears the cookie. */
export async function attachSource(newUserId: string) {
  const v = campaignCookie();
  if (cookies().get(SRC_COOKIE)) cookies().delete(SRC_COOKIE);
  const me = await db.user.findUnique({ where: { id: newUserId }, select: { referredById: true, signupSource: true } });
  if (!me || me.signupSource) return;
  await db.user.update({ where: { id: newUserId }, data: { signupSource: resolveSource(v, !!me.referredById) } });
}
