/** Remounts on each admin navigation: panels slide and un-blur in. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="admin-page-in">{children}</div>;
}
