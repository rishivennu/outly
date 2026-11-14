/**
 * What changed in Outlly, newest first. Only things that shipped: add an entry when a change goes live,
 * never ahead of it. The /changelog page renders this list as it is.
 */
export type ChangelogEntry = { date: string; title: string; body: string };

export const CHANGELOG: ChangelogEntry[] = [
  { date: "2026-11-14", title: "Content library search and bulk actions", body: "Search your library by title, caption, tag or file name, then select several posts and delete them in one go." },
  { date: "2026-11-14", title: "Undo after deleting posts, library items and snippets", body: "Deleting a draft, a library item or a snippet now shows Undo for a few seconds before anything is removed." },
  { date: "2026-11-14", title: "Status and security pages", body: "See whether Outlly is up right now, and read how your account, tokens and payments are protected." },
  { date: "2026-11-14", title: "Clearer status colours and larger small text", body: "Status words are easier to read on light backgrounds, and no text is smaller than 12px." },
  { date: "2026-11-13", title: "Bigger touch targets on phones (44px) and a 12px floor for small text", body: "Buttons and links are easier to tap on a phone, and the smallest captions are easier to read." },
  { date: "2026-11-13", title: "Menu closes with Escape and returns focus", body: "Press Escape to close the menu, and keyboard focus goes back to the button that opened it." },
];

/** "14 November 2026", fixed to UTC so the server and every reader agree on the day. */
export const changelogDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Entries grouped by day, in the list's order. */
export function changelogByDay(list: ChangelogEntry[] = CHANGELOG) {
  const days: { date: string; entries: ChangelogEntry[] }[] = [];
  for (const e of list) {
    const last = days[days.length - 1];
    if (last?.date === e.date) last.entries.push(e);
    else days.push({ date: e.date, entries: [e] });
  }
  return days;
}
