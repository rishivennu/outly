# Edge to edge: status bar, safe areas, installed apps

What Outlly controls at the top and bottom edges of a phone, what the operating system decides, and how to check it
on a real device. Rounds 1105-1108 (theme-color), 1215 (iOS status bar style), R1279 (safe-area system), R1283
(platform hardening, this document).

## Architecture

**One rule: the background runs edge to edge, the content stays inside the safe area.** Nothing draws a fake clock,
battery or signal icon; the OS paints its own indicators over our background.

| Piece | Where | What it does |
| --- | --- | --- |
| Safe-area tokens | `app/globals.css`, block `R1279 safe area` | `--sa-t/--sa-b/--sa-l/--sa-r` = `env(safe-area-inset-*, 0px)`, `--sa-float` = `--sa-b` + 84px (above the phone tab bar). These four lines are the only `env(safe-area-inset` in the repo (`tests/round-1279-safe-area.test.ts`). Every other rule reads the tokens, so a notch can be simulated by setting the vars on `<html>`. |
| Status band | `.sa-band`, mounted once in `components/shared/RootClient.tsx` | Fixed, `top: 0`, height `--sa-t`, z 29, no pointer events. Paints the page colour (84% + blur, solid under reduced transparency / forced colours / more contrast) behind the OS indicators when a header is folded away or a page has none. Hidden on the first-launch welcome and in the Android app's Create route. |
| Headers | `.mtop` (studio phone bar, `components/shell/Nav.tsx`), `.admin-top` (`components/admin/AdminShell.tsx`) | Pad `padding-top: var(--sa-t)`; fold with `translateY(-100%)` on the way down, so the band takes over. Admin desktop sidebar and header use `max(<own padding>, var(--sa-t))` for iPad under the translucent bar (R1283). |
| Bottom | `.mtab`, `.admin-tabbar`, toasts, sheets, cookie banner | Sit at `calc(var(--sa-b) + 8px)` or `--sa-float`, so nothing touches the home indicator or the gesture area. `.mmain` pads `--sa-l/--sa-r` in landscape. |
| Viewport | `app/layout.tsx` `generateViewport` | `viewport-fit=cover` (without it every inset is 0), `themeColor` from the theme cookie, `colorScheme` from the theme cookie (R1283: the first frame before CSS has the theme's canvas and form controls, no white flash on the dark default). `app/(marketing)/layout.tsx` only overrides `themeColor` with the public pages' "sky" light surface. Exactly two viewport exports in `app/` (pinned by test). |
| theme-color sync | `lib/theme/script.ts` (head, before paint), `lib/theme/statusbar.ts` + `components/shared/StatusBarSync.tsx` | The head script applies the saved theme, writes the wanted colour to `html[data-tc]` and holds every `meta[name=theme-color]` to it with a MutationObserver (Next adds a second tag after hydration). After each route change and each theme or welcome change, `syncStatusBar()` re-reads the surface (`.sky-host` = public pages and admin; light sky `#f3f6fa` vs app `#f5f7f9`; dark is `#0c0c0e` on both). Values are the `--background` tokens as hex (`lib/theme/colors.ts`, pinned to the CSS by `tests/round-1105-bars.test.ts`). |
| iOS status bar style | `lib/theme/colors.ts` `iosStatusBarStyle` | Dark (and no choice yet) = `black-translucent`: the page runs under the bar, white indicators over our dark background. Light = `default`: dark indicators. Used by the root metadata and, since R1283, by the admin pages (`lib/admin/app-meta.ts`); before R1283 the admin was fixed on `default`, which painted a white strip above the dark console. |
| Manifests | `app/manifest.ts` (studio, opens `/home`), `app/admin.webmanifest/route.ts` (team console, opens `/admin`) | `display: standalone`, `theme_color` and `background_color` = `THEME_COLOR.dark` (one static file, so the default theme; the page's meta theme-color takes over once it loads). |
| Service worker | `public/sw.js` | Navigations to studio pages are network first; only when the network has not answered within `NAV_WAIT` (2.5 s) or fails does the last kept copy of that page answer. `/_next/static` is cache first (fingerprinted files, at most 150). `/api` and `/admin` are never touched. No `skipWaiting`: a new worker waits until every Outlly window is closed. |
| Fresh on resume | `components/pwa/FreshOnResume.tsx`, `lib/client/fresh-on-resume.ts`, `app/api/build/route.ts` | Installed apps only. When the app comes back after 10 minutes or more it asks `/api/build` (no-store) for the running build and compares it with `NEXT_PUBLIC_BUILD` (the commit, inlined by `next.config.mjs`). Different: a toast "Outlly has an update." with a Reload button. Never reloads by itself (drafts), at most one toast per build per session. |

## Per-platform matrix

| Platform | Status bar background | Icon colour | Bottom inset | What we control | What the OS decides |
| --- | --- | --- | --- | --- | --- |
| iOS Safari (tab) | Safari's own chrome. Tinted from `theme-color` on iOS 15 to 18 (WebKit: "change the color of the status bar and overscroll area in Safari on iOS 15"). | Safari picks light or dark for the tint. | `env(safe-area-inset-bottom)` is the toolbar / home indicator area when the toolbar collapses. | theme-color value, page background, safe-area padding. | Whether the tint is used (user setting "Allow Website Tinting", compact vs bottom tab bar, Safari version). `apple-mobile-web-app-*` tags do nothing here. |
| iOS Home Screen app | Dark: our page (`black-translucent`, the page runs under the bar; `.sa-band` paints it while the header is folded). Light: iOS draws an opaque bar (`default`). | Dark: white. Light: black. | `--sa-b` (home indicator, 34 px on Face ID phones). | The status bar style tag, theme-color, safe-area padding. | The style is read once at launch: a theme switch shows after the app is closed and reopened. There is no "white-translucent" style, so a light page cannot run under the bar with dark indicators. |
| Android Chrome tab | Chrome's toolbar and the status bar take `theme-color` in the light UI. | Chrome picks contrast for the colour. | Usually 0 (Chrome's own UI holds the gesture area). | theme-color. | In Chrome's dark mode the tab ignores theme-color and paints its own dark grey. |
| Android installed PWA (Chrome / WebAPK) | Opaque bar in `theme-color` (meta tag once loaded, manifest `theme_color` on the splash and first frame). | Chrome picks contrast for the colour. | Respected through `env(safe-area-inset-bottom)` with `viewport-fit=cover` when Chrome draws the app edge to edge (newer Chrome on Android 15+); 0 otherwise. | theme-color, manifest colours, safe-area padding. | Whether the app is drawn behind the bars at all (Chrome version, Android version, navigation mode). The splash colour is the manifest's dark colour for everyone. |
| Capacitor Android app (`outlly-app`, `html[data-app]`) | Our page (edge to edge, drawn behind both bars). | Set from the page: `SystemBars.setStyle` DARK (light icons) / LIGHT (dark icons) from the head script and `syncStatusBar`. | Native insets passed to the WebView as `env(safe-area-inset-*)`. | Everything in the wrapper checklist below. | OEM skins can override the navigation bar scrim on three-button navigation. |
| iPad (Safari / Home Screen) | As iOS above; the status bar is 24 px, no notch. | As iOS above. | 20 px home indicator; 0 with a Home button. | Same tokens; the admin desktop sidebar and header (1024 px and up) use `max(padding, --sa-t)`. | Split View and Slide Over resize the window; insets follow the window, not the screen. |

## Known OS limits

- iOS reads `apple-mobile-web-app-status-bar-style` once, when the Home Screen app launches. Switching theme inside Outlly changes the page at once, but the bar style changes on the next launch.
- iOS has three styles only: `default`, `black`, `black-translucent` (Apple Safari HTML reference). Only `black-translucent` lets the page run under the bar, and its indicators are always white. A light page therefore keeps the opaque `default` bar.
- On iOS 26 Safari reportedly takes its chrome colour from the page itself rather than theme-color. Not verified here: check on a device running it.
- Chrome on Android ignores theme-color in a normal tab while Chrome is in dark mode.
- An installed Android PWA's status bar is opaque in Chrome's chosen colour. Only the native wrapper can make it truly transparent.
- The manifest is one static file: the Android splash screen and the very first frame of an installed app are the dark colour for everyone, light users included.
- An installed app page can stay alive for days without navigating. It keeps the build it was opened with until it is reloaded (see "How to pick up a new version").
- Desktop emulation (Playwright with injected `--sa-*` values) proves layout, never how the OS paints its bar. Every row of the matrix has to be checked on a real device.

## Capacitor wrapper checklist

The Android app lives in the separate `outlly-app` repo. The web side already marks `html[data-app]` before paint, loads `app/mobile-app.css`, and calls `SystemBars.setStyle` on launch and on every theme change. The wrapper must:

1. Enable edge to edge in `MainActivity` (`WindowCompat.setDecorFitsSystemWindows(window, false)`, or `enableEdgeToEdge()` with androidx.activity), and target SDK 35+ where edge to edge is the default.
2. Status bar: overlay the WebView (`StatusBar.setOverlaysWebView({ overlay: true })` or the Capacitor 8 SystemBars equivalent) with a transparent colour, so the page background shows behind it. No `backgroundColor` on the bar.
3. Navigation bar: transparent, `isNavigationBarContrastEnforced = false` so three-button navigation does not get a grey scrim, and icon style following the same DARK/LIGHT call.
4. Cutouts: `windowLayoutInDisplayCutoutMode = shortEdges` (or `always` on API 30+) in the theme, so the page reaches into the punch hole area and `env(safe-area-inset-top)` reports it.
5. Insets into the WebView: confirm `env(safe-area-inset-*)` is non-zero in the WebView (Android System WebView 136+ reports them in an edge-to-edge activity; on older WebView versions the wrapper must inject them, for example as `--sa-*` on `<html>`, which every rule already reads).
6. Keyboard: `android:windowSoftInputMode="adjustResize"` and the Capacitor Keyboard `resize: "native"` (or `body`), so the Create sheet's fields stay above the keyboard and the bottom inset is not counted twice.
7. Splash: the splash background per theme (`values/` light, `values-night/` dark, matching `THEME_COLOR`), then hide the splash after the first paint, so there is no white frame between splash and page.
8. Test matrix: gesture and three-button navigation, a punch-hole and a notched device, landscape both ways, dark and light.

## Real-device test script

Use a real iPhone (Face ID), a real Android phone, and an iPad. Install both apps first: Safari > Share > Add to Home Screen; Chrome > menu > Install app. Run each check in dark and in light (Settings in Outlly, then close and reopen the app on iOS, because the bar style is read at launch).

- [ ] 1. Native time, signal, Wi-Fi and battery are visible and readable on `/home` at rest (Home Screen app, dark: white icons over our dark page; light: dark icons on a light bar).
- [ ] 2. `/home` scrolled down: the header folds away, and the area behind the clock is the page colour (no black or white strip, no content readable under the clock).
- [ ] 3. `/analytics` scrolled down (the original complaint): cards slide under a band of page colour, never sharp under the clock.
- [ ] 4. Scroll back up on `/analytics`: the header returns without a jump, its content starts below the indicators.
- [ ] 5. `/create`: open the platform / publish sheet. It clears the top inset and its buttons sit above the home indicator.
- [ ] 6. Bottom tab bar on `/home`: above the home indicator on iPhone; above the gesture pill and above the three buttons on Android (switch navigation mode in Android settings and repeat).
- [ ] 7. A toast (save something in `/settings`) and the cookie banner (fresh install) sit above the tab bar, not on it.
- [ ] 8. `/admin` in the admin Home Screen app: dark = no white strip above the header (fixed in R1283), light = dark icons on a light bar. Open the menu drawer: it clears the top and bottom insets.
- [ ] 9. `/admin` on iPad landscape (1024 px and up): the sidebar card and the header sit below the status bar.
- [ ] 10. Landscape iPhone on `/home` and `/analytics`: nothing sits inside the notch side; the tab bar and header keep clear of the rounded corners.
- [ ] 11. Theme switch inside the app: the page and the Android status bar (theme-color, Capacitor icons) change at once; on iOS the bar style follows after closing and reopening.
- [ ] 12. Navigate `/` (public page) to `/home` and back in light: no flash of a different colour behind the clock.
- [ ] 13. Safari tab (not installed) on `/` and `/home`: Safari's own bar behaves normally; the page does not pad an extra gap at the top.
- [ ] 14. Android Chrome tab in Chrome's dark mode: Chrome's grey bar is expected (OS limit), the page itself has no gap.
- [ ] 15. Cold launch the installed app (swipe it away, open it again): no white frame before the first paint on the dark theme; the app opens on `/home` signed in.

### How to pick up a new version on an installed app

An installed app keeps the page it opened with. To get the latest version either:

- close it fully (iOS: swipe it up out of the app switcher; Android: swipe it away in Recents) and open it again, or
- leave it in the background for 10 minutes or more after a deploy, come back, and press **Reload** on the "Outlly has an update." toast.

The toast never reloads by itself, so an unsaved draft is safe until you press it.
