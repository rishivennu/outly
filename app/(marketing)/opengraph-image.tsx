import { ImageResponse } from "next/og";

export const alt = "Outlly — your content deserves to be everywhere.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Generated rather than shipped as a PNG, so the headline can never drift from the page.
 * Deliberately flat: the 3D icon set is raster and would need fetching at render time.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0c0c0e",
          color: "#f7f4ec",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: "#c6f432", display: "flex" }} />
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.04em" }}>outlly</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 86, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1.0, maxWidth: 940 }}>
            Your content deserves to be everywhere.
          </div>
          <div style={{ fontSize: 30, color: "#a8a39a", maxWidth: 820, lineHeight: 1.35 }}>
            Upload once. AI tailors it for every platform. Publish and track from one workspace.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, fontSize: 26, color: "#f7f4ec" }}>
          {["Instagram Reels", "YouTube Shorts", "X"].map((p) => (
            <div key={p} style={{ display: "flex", border: "1px solid #2a2a30", borderRadius: 999, padding: "10px 24px" }}>
              {p}
            </div>
          ))}
          <div style={{ display: "flex", background: "#c6f432", color: "#0c0c0e", borderRadius: 999, padding: "10px 24px", fontWeight: 600 }}>
            Free during beta
          </div>
        </div>
      </div>
    ),
    size,
  );
}
