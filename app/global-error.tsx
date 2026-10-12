"use client";

/** Last resort when the root layout itself fails: no app CSS is guaranteed, so styles are inline. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#faf8f3", color: "#121214", textAlign: "center", padding: 24 }}>
        <main>
          <div aria-hidden style={{ width: 72, height: 72, borderRadius: 22, background: "#9ff218", margin: "0 auto 20px" }} />
          <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Outlly hit a snag.</h1>
          <p style={{ opacity: 0.72, maxWidth: "36ch", margin: "0 auto 22px", lineHeight: 1.5 }}>Nothing you made is lost. Reload to continue{error.digest ? ` (ref ${error.digest})` : ""}.</p>
          <button onClick={reset} style={{ background: "#121214", color: "#fff", border: 0, borderRadius: 999, padding: "12px 22px", font: "600 15px system-ui", cursor: "pointer" }}>Try again</button>{" "}
          <a href="/help" style={{ color: "#121214", fontWeight: 600, marginLeft: 12 }}>Get help</a>
        </main>
      </body>
    </html>
  );
}
