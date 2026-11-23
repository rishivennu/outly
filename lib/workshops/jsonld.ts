import type { WorkshopView } from "./core";

/** schema.org Event data for the public workshop pages. Pure and client-safe. */
const ORGANIZER = { "@type": "Organization", name: "Outlly", url: "https://outlly.com" } as const;

const eventData = (w: WorkshopView, url: string) => ({
  "@type": "Event",
  name: w.title,
  ...(w.summary ? { description: w.summary } : {}),
  startDate: w.startsAt,
  endDate: w.endsAt,
  eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
  eventStatus: w.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
  location: { "@type": "VirtualLocation", url },
  organizer: ORGANIZER,
  ...(w.host ? { performer: { "@type": "Person", name: w.host } } : {}),
  ...(w.coverUrl ? { image: [w.coverUrl] } : {}),
  offers: { "@type": "Offer", price: 0, priceCurrency: "INR", availability: w.capacity && (w.seatsLeft ?? 0) <= 0 ? "https://schema.org/SoldOut" : "https://schema.org/InStock", url },
  url,
});

export const eventJsonLd = (w: WorkshopView, url: string) => ({ "@context": "https://schema.org", ...eventData(w, url) });

export function listJsonLd(list: WorkshopView[], base: string) {
  const root = base.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: list.map((w, i) => ({ "@type": "ListItem", position: i + 1, item: eventData(w, `${root}/workshops/${w.slug}`) })),
  };
}

/** JSON for a <script> tag: `<` escaped so a title can never close the tag. */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
