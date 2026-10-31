/** Pip watching the auth form (1075): what it says and when it closes its eyes. */
import { describe, expect, test } from "bun:test";
import { firstName, looksLikeEmail, watchLine, type WatchState } from "@/lib/mascot/watch";

const base: WatchState = { mode: "signup", step: "password", focus: null, name: "", email: "", password: "", busy: false, error: null, success: null, sent: false, adult: false };
const say = (o: Partial<WatchState>) => watchLine({ ...base, ...o });

describe("watchLine (sign up)", () => {
  test("asks for a name, then says it back", () => {
    expect(say({}).say).toBe("Hi! What's your name?");
    expect(say({ focus: "name" }).say).toBe("Hi! What's your name?");
    expect(say({ focus: "name", name: "Adrien Dupont" }).say).toBe("Hi Adrien!");
  });
  test("greets on the email field, then approves a real-looking address", () => {
    expect(say({ focus: "email", name: "Adrien" }).say).toBe("Nice to meet you, Adrien!");
    expect(say({ focus: "email", name: "Adrien", email: "info@adrien" }).say).toBe("Nice to meet you, Adrien!");
    expect(say({ focus: "email", name: "Adrien", email: "info@adrien.dev" }).say).toBe("That looks right.");
  });
  test("closes its eyes for every password field", () => {
    for (const focus of ["password", "new-password", "confirm-password"]) {
      const l = say({ focus, step: focus === "password" ? "password" : "reset" });
      expect(l.say).toBe("I'm not looking.");
      expect(l.shut).toBe(true);
    }
    expect(say({ focus: "email" }).shut).toBeUndefined();
  });
  test("flags an email that doesn't look right once you leave it", () => {
    expect(say({ name: "A", email: "nope" }).say).toBe("Hmm, check that email?");
  });
  test("almost there, then all set when the 18+ box is ticked", () => {
    const ready = { name: "Adrien", email: "a@b.co", password: "12345678" };
    expect(say(ready).say).toBe("Almost there.");
    expect(say({ ...ready, adult: true })).toEqual({ mood: "happy", say: "All set, Adrien!" });
  });
  test("busy and errors win over focus", () => {
    expect(say({ busy: true, focus: "password" }).mood).toBe("think");
    expect(say({ error: "Please confirm you're 18 or older to create an account." }).say).toBe("Just tick the 18+ box.");
    expect(say({ error: "That email is taken" })).toEqual({ mood: "sad", say: "Oops. Let's fix that." });
  });
});

describe("watchLine (sign in)", () => {
  const login = (o: Partial<WatchState>) => say({ mode: "login", ...o });
  test("welcome back, code steps, and the second step", () => {
    expect(login({}).say).toBe("Welcome back!");
    expect(login({ step: "code" }).say).toBe("I'll email you a code.");
    expect(login({ step: "code", sent: true, focus: "otp-3" }).say).toBe("Check your inbox.");
    expect(login({ step: "2fa", focus: "otp" }).say).toBe("The code from your app.");
    expect(login({ success: "Password changed." }).mood).toBe("happy");
  });
});

describe("helpers", () => {
  test("first name is short and single-word", () => {
    expect(firstName("  Rishi  Vennu ")).toBe("Rishi");
    expect(firstName("Bartholomewsonberg").length).toBe(14);
    expect(firstName("")).toBe("");
  });
  test("email shape", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
    expect(looksLikeEmail("a b@c.de")).toBe(false);
  });
});
