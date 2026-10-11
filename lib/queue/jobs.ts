import type { Platform } from "../domain";
import type { SimulationMode } from "../social/types";

export const JOBS = {
  VIDEO_PROCESS: "VIDEO_PROCESS",
  VIDEO_THUMBNAIL: "VIDEO_THUMBNAIL",
  SOCIAL_UPLOAD: "SOCIAL_UPLOAD",
  SOCIAL_PUBLISH: "SOCIAL_PUBLISH",
  SOCIAL_STATUS_CHECK: "SOCIAL_STATUS_CHECK",
  SCHEDULED_POST: "SCHEDULED_POST",
  TOKEN_REFRESH: "TOKEN_REFRESH",
} as const;
export type JobName = keyof typeof JOBS;

export interface JobPayloads {
  VIDEO_PROCESS: { mediaId: string };
  VIDEO_THUMBNAIL: { mediaId: string };
  SOCIAL_UPLOAD: { targetId: string; platform: Platform; simulate?: SimulationMode };
  SOCIAL_PUBLISH: { targetId: string; platform: Platform; simulate?: SimulationMode };
  SOCIAL_STATUS_CHECK: { targetId: string; platform: Platform; simulate?: SimulationMode; poll: number };
  SCHEDULED_POST: { postId: string };
  TOKEN_REFRESH: { accountId: string };
}

/** Queue topology: one queue per platform so a slow YouTube upload never blocks an X post. */
export function queueFor(name: JobName, data: JobPayloads[JobName]): string {
  if ("platform" in data && data.platform) return `social-${data.platform}`;
  if (name === "VIDEO_PROCESS" || name === "VIDEO_THUMBNAIL") return "media";
  return "system";
}
export const QUEUE_NAMES = ["media", "system", "social-instagram", "social-youtube", "social-x"] as const;
