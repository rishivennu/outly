import "server-only";
import { recordCost } from "../subscriptions/costs";

/**
 * R1331: X's paid API tiers bill every post a read endpoint returns (the Basic tier's monthly cap is on posts
 * read, not requests). Count the posts that came back at the 1147 `x_read` rate: an estimate into the cost
 * ledger and the payer's month, never a block. Nothing for other platforms, practice accounts or empty answers.
 */
export async function meterXReads(userId: string, platform: string, posts: number, practice = false) {
  if (platform !== "x" || practice || !(posts > 0)) return null;
  return recordCost({ userId, category: "x_read", units: Math.floor(posts) });
}
