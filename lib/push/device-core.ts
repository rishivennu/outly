/*
 * 1118: a readable name for a device that turned on notifications, from its user agent. Pure, so tests pin it.
 * Shown in Settings > Notifications > Connected devices; never used to decide anything.
 */

export type DevicePlatform = "ios" | "android" | "desktop";
export interface DeviceInfo {
  platform: DevicePlatform;
  device: string;
  client: string;
}

export function describeDevice(ua: string, o: { installed?: boolean; touchMac?: boolean } = {}): DeviceInfo {
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && !!o.touchMac);
  const ios = ipad || /iPhone|iPod/.test(ua);
  const android = /Android/.test(ua);
  const platform: DevicePlatform = ios ? "ios" : android ? "android" : "desktop";
  const device = ios
    ? ipad
      ? "iPad"
      : "iPhone"
    : android
      ? /Mobile/.test(ua)
        ? "Android phone"
        : "Android tablet"
      : /Windows/.test(ua)
        ? "Windows PC"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /CrOS/.test(ua)
            ? "Chromebook"
            : /Linux/.test(ua)
              ? "Linux computer"
              : "Computer";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome|CriOS|Chromium/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "Browser";
  // On iPhone and iPad web push only exists for the Home Screen app (iOS 16.4+), so it always is one there.
  const client = o.installed || ios ? (platform === "desktop" ? `${browser} app` : "Home Screen app") : browser;
  return { platform, device, client };
}
