/** 1142: the welcome greets on every entry into Outlly, by the time of day on the person's clock. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WELCOME_DEFAULT, fillGreeting, fillName, fromInsideStudio, greetingFor, headlineParts, normalizeWelcome, shouldWelcome, welcomeScript } from "../lib/pwa-welcome";

const w = readFileSync("components/shell/PwaWelcome.tsx", "utf8");
const o = "https://outlly.com";

describe("1142 time-of-day greeting", () => {
  test("morning 5-11, afternoon 12-16, evening the rest", () => {
    expect([4, 5, 11, 12, 16, 17, 23, 0].map(greetingFor)).toEqual(["Good evening", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening", "Good evening"]);
    expect(greetingFor(-1)).toBe("Good evening");
    expect(greetingFor(29)).toBe("Good morning");
  });
  test("the default headline reads well with and without a name", () => {
    expect(fillName(fillGreeting(WELCOME_DEFAULT.title, 9), "Maya Rao")).toBe("Good morning, Maya. Let's get to it.");
    expect(fillName(fillGreeting(WELCOME_DEFAULT.title, 20), "")).toBe("Good evening. Let's get to it.");
    expect(headlineParts(fillName(fillGreeting(WELCOME_DEFAULT.title, 14), "Maya")).lines).toEqual(["Good afternoon, Maya."]);
    expect(WELCOME_DEFAULT.title.length).toBeLessThanOrEqual(60);
  });
  test("a custom headline without {greeting} stays as written", () => {
    expect(fillGreeting("Hey {name}.", 9)).toBe("Hey {name}.");
    expect(normalizeWelcome({ title: "Hey {name}." }).title).toBe("Hey {name}.");
  });
  test("old saved defaults follow the new one", () => {
    expect(normalizeWelcome({ title: "Welcome, {name}." }).title).toBe(WELCOME_DEFAULT.title);
    expect(normalizeWelcome({ body: "Outlly now lives on your Home Screen. Plan, post and reply from one place, one tap away." }).body).toBe(WELCOME_DEFAULT.body);
  });
  test("the component greets on the device clock and the account time zone", () => {
    expect(w).toContain("fillGreeting(config.title, hour)");
    expect(w).toContain('hourCycle: "h23", timeZone: tz');
    expect(w).toContain("setHour(new Date().getHours())");
  });
});

describe("1142 every entry", () => {
  test("a browser tab, an installed launch and the Android app all greet; seen this visit does not", () => {
    expect(shouldWelcome({ path: "/home", seen: false, referrer: "", origin: o })).toBe(true);
    expect(shouldWelcome({ path: "/calendar", seen: false, referrer: "https://www.google.com/", origin: o })).toBe(true);
    expect(shouldWelcome({ path: "/home", seen: false, referrer: `${o}/login`, origin: o })).toBe(true); // signing in is an entry
    expect(shouldWelcome({ path: "/home", seen: true, referrer: "", origin: o })).toBe(false);
  });
  test("a tab opened from inside the studio is the same visit", () => {
    expect(fromInsideStudio(`${o}/calendar`, o)).toBe(true);
    expect(fromInsideStudio(`${o}/login`, o)).toBe(false);
    expect(fromInsideStudio("https://outlly.com.evil.com/home", o)).toBe(false);
    expect(shouldWelcome({ path: "/home", seen: false, referrer: `${o}/content`, origin: o })).toBe(false);
  });
  test("remembered per tab (sessionStorage), not per device", () => {
    expect(welcomeScript).toContain("sessionStorage.getItem(");
    expect(welcomeScript).not.toContain("localStorage");
    expect(w).toContain("sessionStorage.getItem(WELCOME_SESSION_KEY)");
  });
  test("the head script runs and flags a studio entry", () => {
    const html = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; } };
    const store: Record<string, string> = {};
    const run = (path: string, referrer = "") =>
      new Function("document", "location", "sessionStorage", "setTimeout", "window", welcomeScript)(
        { documentElement: html, referrer },
        { origin: o, pathname: path },
        { getItem: (k: string) => store[k] ?? null },
        () => 1,
        {},
      );
    run("/home");
    expect("data-welcome" in html.attrs).toBe(true);
    html.removeAttribute("data-welcome");
    run("/login");
    expect("data-welcome" in html.attrs).toBe(false);
    store["outlly:welcomed-entry"] = "1";
    run("/home");
    expect("data-welcome" in html.attrs).toBe(false);
  });
});
