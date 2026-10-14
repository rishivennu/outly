/**
 * Shown the instant an admin link is clicked, inside the sidebar shell, while the server renders the page.
 * Next prefetches this boundary for every visible sidebar link, so the click itself never waits on the network.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="admin-skel">
      <span className="sr-only">Loading</span>
      <div className="mb-7 space-y-3" aria-hidden>
        <div className="skeleton h-8 w-64 max-w-[70%] rounded-xl" />
        <div className="skeleton h-4 w-[26rem] max-w-[90%] rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-[24px] bg-card p-5 hairline">
            <div className="skeleton h-3 w-20 rounded" />
            <div className="skeleton mt-3 h-7 w-24 rounded-lg" />
            <div className="skeleton mt-3 h-3 w-16 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-[24px] bg-card p-5 hairline sm:p-6" aria-hidden>
        <div className="skeleton h-4 w-40 rounded" />
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-10 rounded-xl" style={{ opacity: 1 - i * 0.14 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
