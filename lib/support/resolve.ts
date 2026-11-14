/**
 * "My issue is resolved" detection for Pip (1126). Pure and client-safe.
 *
 * Pip never closes anything on its own: a match only makes it ASK ("Resolve & Send Transcript" or "Continue
 * Chat"). Even so it stays strict, because the prompt is in the way when someone still has a question:
 * - a plain "thanks", "ok" or "great" is NOT enough (that's small talk, they may go on);
 * - a question mark, a follow-up ("but", "also", "one more thing") or a negation ("not resolved",
 *   "didn't fix it", "still") cancels the match;
 * - long messages don't count: someone who writes a paragraph is usually explaining a new problem;
 * - there must already be an answer from Pip in this chat, otherwise there is nothing to resolve.
 * Asking to close the chat ("can you close this conversation?") is the one case where a "?" is fine.
 */

const STRONG: RegExp[] = [
  /\bgot (the|my|an|your|a) (answer|answers|solution|fix|reply|help)\b/,
  /\bgot (what|everything) (i|we) (needed|wanted|was looking for)\b/,
  /\b(issue|problem|question|questions|query|doubt|doubts|concern|it|everything)('s| is| was| has been| got| have been| are)? (now )?(resolved|solved|fixed|sorted( out)?|answered|cleared( up)?|clear now)\b/,
  /\b(that|this|it|you|your answer|the answer)( has| have|'s| really| just| totally)? (solved|resolved|fixed|sorted|answered|cleared)( it| that| this| my| the| everything| everything up)?\b/,
  /\b(that|this|it) (worked|works now|helped|helps|did it|did the trick|was helpful|is helpful|was perfect|makes sense now)\b/,
  /\b(works|working|it works) (now|perfectly|fine now)\b/,
  /\b(very|really|super|so) helpful\b/,
  /\bhelped (a lot|me|loads)\b/,
  /\b(that'?s|that is|that will be|that'?ll be|thats) (all|it|everything)\b/,
  /\b(nothing|no) (else|more)( for now| needed| questions?| thanks| thank you)?\b/,
  /\bno (further|other|more) (questions|doubts|queries)\b/,
  /\b(all|i'?m all|we'?re all) (set|sorted|done|good now)\b/,
  /\b(i'?m|i am|we'?re|we are) (done|good now|sorted|all good)( here| now| for now)?\b/,
  /\b(i'?m|i am|we'?re|we are) (satisfied|happy|pleased) with\b/,
  /\b(satisfied|happy) with (the|your|this|that) (answer|reply|help|response|solution)\b/,
  /\bi understand now\b|\bmakes sense now\b|\bunderstood,? thanks?\b/,
];

/** Asking for the chat to be closed. Allowed even as a question. */
const CLOSE = /\b(close|end|finish|wrap up|resolve) (this|the|our|my) (chat|conversation|ticket|session)\b|\bmark (it|this|the chat|the conversation) (as )?(resolved|solved|done|closed)\b|\byou can close (it|this)\b/;

/** Hindi and Hinglish, the second most used language in Pip. Devanagari has no \b, so these are substrings. */
const HI_STRONG = ["हो गया", "हल हो गया", "समझ गया", "समझ गई", "समझ आ गया", "मिल गया", "बस इतना ही", "और कुछ नहीं चाहिए"];
const HINGLISH = /\b(ho gaya|ho gya|hogaya|samajh (gaya|gayi|aa gaya)|mil gaya|bas itna hi|aur kuch nahi chahiye)\b/;

const NEGATION = /\b(not|isn'?t|wasn'?t|didn'?t|doesn'?t|don'?t|do not|hasn'?t|haven'?t|aren'?t|never|still|can'?t|cannot|won'?t|unable|nahi|nahin|na)\b/;
const HI_NEG = ["नहीं", "ना "];
const FOLLOW_UP = /\b(but|also|another|one more|next question|however|although|though|except|wait|what about|how (do|can|to|about)|can you|could you|help me|why)\b/;
// "Thanks but no" is not "no more", and "not bad" is small talk, both handled by the rules above.

/** Starts like a question even without the "?": "is it resolved", "did that fix it". */
const ASKS = /^(is|are|was|were|did|does|do|can|could|will|would|should|has|have|why|how|what|when|where|which|who)\b/;

const MAX_WORDS = 18;

/**
 * A bare "no" / "nothing" is only a goodbye when Pip has just invited more ("Anything else?", "...just let me
 * know."). Checked before the negation rule, because "no" and "nahi" ARE negations everywhere else.
 */
const BARE_DONE = /^(no|nope|nah|na|nothing|none|nahi|nahin|not really|not now|nothing else|nothing more|nothing much|nothing for now|no thanks|no thank you|no all good|no i'?m good|no that'?s all|nope that'?s all|i'?m good|im good|all good|kuch nahi|kuchh nahi|kuch nahin|bas|bas itna hi)( thanks| thank you| thx| ty| for now)?$/;
const HI_BARE_DONE = ["कुछ नहीं", "नहीं", "बस", "नहीं धन्यवाद", "कुछ नहीं धन्यवाद"];
const INVITES_MORE = /\?\s*$|anything else|something else|let me know|help (you )?with|any other|और कुछ|कुछ और/i;

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^\p{L}\p{N}'?\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does this one message say the person's problem is solved (or ask to close the chat)? */
export function isResolutionIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length > 160) return false;
  const t = norm(raw);
  if (!t || t.split(" ").length > MAX_WORDS) return false;
  const close = CLOSE.test(t);
  const hiNeg = HI_NEG.some((n) => raw.includes(n));
  // "don't close this chat", "no, it's not resolved", "abhi nahi hua"
  if (NEGATION.test(t) || hiNeg) return false;
  if (close) return true;
  if (/\?/.test(raw) || ASKS.test(t) || FOLLOW_UP.test(t)) return false;
  return STRONG.some((r) => r.test(t)) || HINGLISH.test(t) || HI_STRONG.some((p) => raw.includes(p));
}

/**
 * Offer to resolve? The message must say so AND Pip must already have answered something in this chat
 * (a first message of "solved it" has nothing to resolve). History is the browser's last few turns.
 */
export function wantsToResolve(text: string, history: { role: "user" | "bot"; text: string }[]): boolean {
  if (!history.some((h) => h.role === "bot" && h.text.trim())) return false;
  if (isResolutionIntent(text)) return true;
  const lastBot = [...history].reverse().find((h) => h.role === "bot")?.text.trim() ?? "";
  return isDoneReply(text, lastBot);
}

/** "nothing" / "no thanks" in answer to Pip asking if there is anything else. */
export function isDoneReply(text: string, lastBot: string): boolean {
  if (!INVITES_MORE.test(lastBot)) return false;
  const raw = text.trim().replace(/[.!\s]+$/u, "");
  if (!raw || raw.length > 40) return false;
  return BARE_DONE.test(norm(raw)) || HI_BARE_DONE.includes(raw);
}

/**
 * 1151: "email me the transcript", "send me a copy of this chat". Pip answers this itself (offer when it can,
 * the plain reason when it can't) instead of letting a model guess, which once said "I can't" and then offered it.
 */
const TRANSCRIPT = /\btranscripts?\b|\b(email|send|mail|forward)( me| it)? (a |the |my )?copy of (this|the|our|my) (chat|conversation)\b|\b(email|mail) (me )?(this|the|our|my) (chat|conversation)\b/;
export function asksForTranscript(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length > 200) return false;
  const t = norm(raw);
  if (/\b(don'?t|do not|no need|never mind|stop)\b/.test(t)) return false;
  return TRANSCRIPT.test(t);
}

/** 1151: "where are my old chats?", "chat history", "find my previous conversation with Pip". */
const PAST_CHATS = /\b(chat|conversation|support) histor(y|ies)\b|\bhistory of (my |our )?(chats|conversations)\b|\b(previous|past|old|older|earlier|last|saved|archived) (pip )?(chats?|conversations?)\b|\b(my|our) (pip|support) (chats|conversations)\b|\b(chats?|conversations?) with (pip|you|support)\b/;
/** Inbox talk ("old conversations in my DMs") is about the Messages page, not Pip. */
const INBOX = /\b(dms?|inbox|messages page|instagram|youtube|whatsapp|comments?|followers?|fans?)\b/;
export function asksForPastChats(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length > 200) return false;
  const t = norm(raw);
  return PAST_CHATS.test(t) && !INBOX.test(t);
}
