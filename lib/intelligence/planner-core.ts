import { PLATFORMS, type Platform } from "../domain";
import { isPostFormat, supportsFormat } from "../formats";

/**
 * R1240: the Growth Planner's lifecycle of one recommendation, pure (no I/O).
 *
 * Status machine (decided in R1240):
 *   open     -> accepted | edited | rejected | saved
 *   saved    -> accepted | edited | rejected
 *   edited   -> edited (refine it again) | done | rejected
 *   accepted -> done | rejected
 *   rejected, done, expired: terminal. There is no reopen: a rejected idea that comes back is a new
 *   recommendation from the engine, so the audit trail of the old one stays true.
 * Feedback is allowed in every status, once per actor.
 */

export const PLANNER_STATUSES = ["open", "accepted", "edited", "rejected", "saved", "done", "expired"] as const;
export type PlannerStatus = (typeof PLANNER_STATUSES)[number];
export const PLANNER_ACTIONS = ["accept", "edit", "reject", "save", "done", "feedback"] as const;
export type PlannerAction = (typeof PLANNER_ACTIONS)[number];
export type PlannerEventType = "accepted" | "edited" | "rejected" | "saved" | "done" | "feedback";

export const EDIT_MAX = { title: 120, concept: 600 } as const;
export const NOTE_MAX = 300;
export const NOTHING_TO_CHANGE = "Nothing to change.";
/** The same action by the same person this soon after is a double click, not a second decision. */
export const DEDUPE_MS = 5_000;

const MOVES: Record<PlannerStatus, readonly PlannerAction[]> = {
  open: ["accept", "edit", "reject", "save"],
  saved: ["accept", "edit", "reject"],
  edited: ["edit", "done", "reject"],
  accepted: ["done", "reject"],
  rejected: [],
  done: [],
  expired: [],
};

const EVENT: Record<PlannerAction, PlannerEventType> = { accept: "accepted", edit: "edited", reject: "rejected", save: "saved", done: "done", feedback: "feedback" };
const STATUS_AFTER: Record<Exclude<PlannerAction, "feedback">, PlannerStatus> = { accept: "accepted", edit: "edited", reject: "rejected", save: "saved", done: "done" };

export const isPlannerStatus = (v: unknown): v is PlannerStatus => typeof v === "string" && (PLANNER_STATUSES as readonly string[]).includes(v);
export const isPlannerAction = (v: unknown): v is PlannerAction => typeof v === "string" && (PLANNER_ACTIONS as readonly string[]).includes(v);
export const eventTypeOf = (a: PlannerAction): PlannerEventType => EVENT[a];

/** The actions allowed from `from`. An unknown status allows nothing but feedback. */
export function transitions(from: string): PlannerAction[] {
  return [...(isPlannerStatus(from) ? MOVES[from] : []), "feedback"];
}

export interface PlannerRec {
  status: string;
  title: string;
  concept: string;
  format: string | null;
  platform: string | null;
}
export interface PlannerHistory {
  type: string;
  actorId: string | null;
}
export type PlannerErrorCode = "ILLEGAL_TRANSITION" | "BAD_PAYLOAD" | "FEEDBACK_GIVEN" | "UNKNOWN_ACTION";
export interface PlannerError {
  error: PlannerErrorCode;
  message: string;
}
export interface PlannerChange {
  status?: PlannerStatus;
  title?: string;
  concept?: string;
  format?: string | null;
  platform?: string | null;
  feedback?: string;
}
export interface PlannerResult {
  next: PlannerChange;
  event: { type: PlannerEventType; data: Record<string, unknown> | null };
}

const fail = (error: PlannerErrorCode, message: string): PlannerError => ({ error, message });
const tidy = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function editOf(rec: PlannerRec, raw: unknown): PlannerChange | PlannerError {
  const p = obj(raw);
  const next: PlannerChange = {};
  if (p.title !== undefined) {
    const t = tidy(p.title);
    if (!t || t.length > EDIT_MAX.title) return fail("BAD_PAYLOAD", `A title is 1 to ${EDIT_MAX.title} characters.`);
    if (t !== rec.title) next.title = t;
  }
  if (p.concept !== undefined) {
    const c = typeof p.concept === "string" ? p.concept.trim() : "";
    if (!c || c.length > EDIT_MAX.concept) return fail("BAD_PAYLOAD", `The idea is 1 to ${EDIT_MAX.concept} characters.`);
    if (c !== rec.concept) next.concept = c;
  }
  if (p.format !== undefined) {
    if (!isPostFormat(p.format)) return fail("BAD_PAYLOAD", "Pick a format: video, photo, carousel or Story.");
    if (p.format !== rec.format) next.format = p.format;
  }
  if (p.platform !== undefined) {
    if (typeof p.platform !== "string" || !(PLATFORMS as readonly string[]).includes(p.platform)) return fail("BAD_PAYLOAD", "Pick a platform Outlly posts to.");
    if (p.platform !== rec.platform) next.platform = p.platform;
  }
  const format = next.format ?? rec.format;
  const platform = next.platform ?? rec.platform;
  if (format && platform && isPostFormat(format) && (PLATFORMS as readonly string[]).includes(platform) && !supportsFormat(platform as Platform, format))
    return fail("BAD_PAYLOAD", `That format can't go out on ${platform} from Outlly yet.`);
  if (!Object.keys(next).length) return fail("BAD_PAYLOAD", NOTHING_TO_CHANGE);
  return next;
}

function feedbackOf(raw: unknown): { helpful: boolean; note: string | null } | PlannerError {
  const p = obj(raw);
  if (typeof p.helpful !== "boolean") return fail("BAD_PAYLOAD", "Say whether it helped.");
  if (p.note !== undefined && p.note !== null && typeof p.note !== "string") return fail("BAD_PAYLOAD", "A note is text.");
  const note = typeof p.note === "string" ? p.note.trim() : "";
  if (note.length > NOTE_MAX) return fail("BAD_PAYLOAD", `A note is up to ${NOTE_MAX} characters.`);
  return { helpful: p.helpful, note: note || null };
}

export const isPlannerError = (r: PlannerResult | PlannerError): r is PlannerError => "error" in r;

/**
 * One action on one recommendation: the fields to write and the event to record, or why it is refused.
 * `history` is the recommendation's earlier events (only feedback needs it).
 */
export function applyAction(rec: PlannerRec, action: string, payload: unknown, actorId: string, history: readonly PlannerHistory[] = []): PlannerResult | PlannerError {
  if (!isPlannerAction(action)) return fail("UNKNOWN_ACTION", "That isn't something you can do to a recommendation.");
  if (action === "feedback") {
    if (history.some((h) => h.type === "feedback" && h.actorId === actorId)) return fail("FEEDBACK_GIVEN", "You've already said what you thought of this one.");
    const f = feedbackOf(payload);
    if ("error" in f) return f;
    return { next: { feedback: JSON.stringify({ ...f, actorId }) }, event: { type: "feedback", data: f } };
  }
  if (!transitions(rec.status).includes(action)) return fail("ILLEGAL_TRANSITION", `A recommendation that is ${isPlannerStatus(rec.status) ? rec.status : "in that state"} can't be ${EVENT[action]}.`);
  if (action === "edit") {
    const e = editOf(rec, payload);
    if ("error" in e) return e;
    return { next: { ...e, status: "edited" }, event: { type: "edited", data: { ...e } } };
  }
  return { next: { status: STATUS_AFTER[action] }, event: { type: EVENT[action], data: null } };
}

export interface Prefill {
  platform: string | null;
  format: string | null;
  topic: string | null;
  title: string;
  concept: string;
  basedOn: string[];
}

const parse = (s: string | null | undefined): Record<string, unknown> => {
  if (typeof s !== "string" || !s.trim()) return {};
  try {
    return obj(JSON.parse(s));
  } catch {
    return {};
  }
};
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x)))].slice(0, 20) : []);

/** What the composer opens with after an accept: the recommendation as it stands now (edits included). */
export function prefillOf(rec: PlannerRec & { nextAction: string; evidence: string }): Prefill {
  const pre = obj(parse(rec.nextAction).prefill);
  const ev = parse(rec.evidence);
  const topic = tidy(pre.topic) || null;
  const basedOn = ids(pre.basedOn);
  return { platform: rec.platform, format: rec.format, topic, title: rec.title, concept: rec.concept, basedOn: basedOn.length ? basedOn : ids(ev.postIds ?? ev.examples) };
}

/** The text of the Idea a saved recommendation becomes. */
export const ideaTextOf = (rec: { title: string; concept: string }): string => `${rec.title}: ${rec.concept}`.slice(0, 500);
