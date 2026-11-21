import "server-only";
import { db } from "./db";
import { parseUiPrefs, serializeUiPrefs, type UiPrefs } from "./nav-config";

/** R1291: the person's own UI preferences (User.uiPrefs). Always the real person, whichever workspace they are in. */
export async function readUiPrefs(userId: string): Promise<UiPrefs> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
  return parseUiPrefs(u?.uiPrefs);
}

/** Read, change, write. Small JSON, one row: a lost race between two of the person's own tabs costs nothing that matters. */
export async function patchUiPrefs(userId: string, change: (p: UiPrefs) => UiPrefs): Promise<UiPrefs> {
  const next = change(await readUiPrefs(userId));
  await db.user.update({ where: { id: userId }, data: { uiPrefs: serializeUiPrefs(next) } });
  return next;
}
