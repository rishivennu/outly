import { json, route } from "@/lib/http";
import { STORAGE_SORTS, storageFiles, type StorageSort } from "@/lib/storage/manager";

export const dynamic = "force-dynamic";

/** R1209: Settings, Storage. Uploaded files and saved drafts with their real sizes; ?sort=largest|oldest|recent|drafts. */
export const GET = route(async (req, { user }) => {
  const s = new URL(req.url).searchParams.get("sort");
  const sort: StorageSort = (STORAGE_SORTS as readonly string[]).includes(s ?? "") ? (s as StorageSort) : "largest";
  return json(await storageFiles(user.id, sort));
}, { limit: [120, 60_000] });
