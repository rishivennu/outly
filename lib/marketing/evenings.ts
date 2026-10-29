import { OUTLLY_MIN_PER_VIDEO, timeSaved, type TimeInput } from "./time-saved";

/** One evening on the "Your evenings" board: 6 pm to midnight. */
export const EVENING_MIN = 6 * 60;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Extra videos land on spread-out days first (Mon, Wed, Fri…), the way most creators post. */
const ORDER = [0, 2, 4, 1, 3, 5, 6];

/** "6:00 pm" + minutes -> "8:24 pm"; capped at midnight. */
export function clockAfter6(min: number) {
  const m = Math.max(0, Math.min(EVENING_MIN, Math.round(min)));
  const h = 18 + Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return h >= 24 ? "12:00 am" : `${h > 12 ? h - 12 : h}:${mm} pm`;
}

/** The week split into evenings: videos per day, minutes by hand and with Outlly, and when you'd be free. */
export function eveningWeek(i: TimeInput) {
  const { manualWeek } = timeSaved(i);
  const videos = Math.min(30, Math.max(1, Math.round(i.videos)));
  const perVideoHand = manualWeek / videos;
  const counts = Array<number>(7).fill(Math.floor(videos / 7));
  for (let k = 0; k < videos % 7; k++) counts[ORDER[k]] += 1;
  return DAYS.map((day, d) => {
    const n = counts[d];
    const handMin = Math.round(n * perVideoHand);
    const outllyMin = n * OUTLLY_MIN_PER_VIDEO;
    return { day, videos: n, handMin, outllyMin, freeFrom: clockAfter6(outllyMin), freeFromHand: clockAfter6(handMin) };
  });
}
