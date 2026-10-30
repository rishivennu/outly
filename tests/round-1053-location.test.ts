import { describe, expect, test } from "bun:test";
import { deviceLabel, ipPlace, looksRelayed, placeKey, placeLabel } from "@/lib/geo";

const hdrs = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()] ?? null;

describe("1053 approximate location from the network", () => {
  test("Cloudflare headers win, with city and region when the managed transform is on", () => {
    expect(ipPlace(hdrs({ "cf-ipcountry": "IN", "cf-region": "Telangana", "cf-ipcity": "Hyderabad" }))).toEqual({ country: "IN", region: "Telangana", city: "Hyderabad", via: "cloudflare" });
  });
  test("Vercel's city is borrowed only when both agree on the country", () => {
    const agree = ipPlace(hdrs({ "cf-ipcountry": "IN", "x-vercel-ip-country": "IN", "x-vercel-ip-city": "Mumbai", "x-vercel-ip-country-region": "MH" }));
    expect(agree?.city).toBe("Mumbai");
    const differ = ipPlace(hdrs({ "cf-ipcountry": "IN", "x-vercel-ip-country": "US", "x-vercel-ip-city": "Ashburn" }));
    expect(differ).toEqual({ country: "IN", region: null, city: null, via: "cloudflare" });
  });
  test("Vercel alone, URL-encoded city decoded and cleaned", () => {
    expect(ipPlace(hdrs({ "x-vercel-ip-country": "br", "x-vercel-ip-city": "S%C3%A3o%20Paulo<script>" }))).toEqual({ country: "BR", region: null, city: "São Pauloscript", via: "vercel" });
  });
  test("Tor is flagged, unknown is null (keeps the last known place)", () => {
    expect(ipPlace(hdrs({ "cf-ipcountry": "T1" }))?.via).toBe("tor");
    expect(ipPlace(hdrs({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(ipPlace(hdrs({}))).toBeNull();
  });
  test("labels never go below a city and repeat nothing", () => {
    expect(placeLabel({ country: "IN", region: "Telangana", city: "Hyderabad", via: "cloudflare" })).toBe("Hyderabad, Telangana, India");
    expect(placeLabel({ country: "SG", region: "Singapore", city: "Singapore", via: "cloudflare" })).toBe("Singapore");
    expect(placeLabel({ country: null, via: "vercel" })).toBeNull();
    expect(placeLabel({ via: "tor" })).toMatch(/Tor/);
  });
  test("placeKey changes only when the place does", () => {
    const a = ipPlace(hdrs({ "cf-ipcountry": "IN", "cf-ipcity": "Pune" }));
    const b = ipPlace(hdrs({ "cf-ipcountry": "IN", "cf-ipcity": "Pune" }));
    const c = ipPlace(hdrs({ "cf-ipcountry": "IN", "cf-ipcity": "Delhi" }));
    expect(placeKey(a)).toBe(placeKey(b));
    expect(placeKey(a)).not.toBe(placeKey(c));
    expect(placeKey(null)).toBe("");
  });
  test("VPN hint: only a clear country and time zone mismatch", () => {
    expect(looksRelayed("US", "Asia/Kolkata")).toBe(true);
    expect(looksRelayed("IN", "Asia/Kolkata")).toBe(false);
    expect(looksRelayed("US", "Etc/UTC")).toBe(false);
    expect(looksRelayed(null, "Asia/Kolkata")).toBe(false);
  });
  test("device labels are coarse", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone or iPad");
    expect(deviceLabel(null)).toBe("A browser");
  });
});
