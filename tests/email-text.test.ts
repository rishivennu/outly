/** 1056. Every email carries a plain-text part (HTML-only mail is a spam signal). */
import { beforeAll, describe, expect, test } from "bun:test";

let mod: typeof import("../lib/email");

beforeAll(async () => {
  process.env.APP_URL = "https://outlly.test/";
  mod = await import("../lib/email");
}, 60_000);

describe("htmlToText", () => {
  test("drops head, style, hidden preheader and images", () => {
    const t = mod.htmlToText(`<html><head><title>T</title><style>a{color:red}</style></head><body><span style="display:none!important">peek text</span><img src="x.png" alt="Logo"><p>Hello</p></body></html>`);
    expect(t).toBe("Hello\n");
  });

  test("keeps link URLs next to their label, decodes entities, breaks on blocks", () => {
    const t = mod.htmlToText(`<p>Hi &amp; welcome&nbsp;in</p><p>Open <a href="https://outlly.test/help?a=1&amp;b=2">Help centre</a></p><div>&copy; 2026 &#x2192; &#8226;</div>`);
    expect(t).toBe("Hi & welcome in\n\nOpen Help centre (https://outlly.test/help?a=1&b=2)\n\u00a9 2026 \u2192 \u2022\n");
  });

  test("image-only links vanish, bare URLs are not doubled, mailto shows the label", () => {
    const t = mod.htmlToText(`<a href="https://x.test/"><img src="m.gif"></a><a href="https://x.test/a">https://x.test/a</a> <a href="mailto:hi@x.test">hi@x.test</a>`);
    expect(t).toBe("https://x.test/a hi@x.test\n");
  });

  test("table cells read left to right", () => {
    expect(mod.htmlToText(`<table><tr><td>Invoice</td><td>INV-7</td></tr><tr><td>Plan</td><td>Pro</td></tr></table>`)).toBe("Invoice INV-7\nPlan Pro\n");
  });
});

describe("real templates", () => {
  test("the sign-in code email reads cleanly as text", () => {
    const html = mod.templates.otp({ name: "Asha", code: "482913", minutes: 10 });
    const t = mod.htmlToText(html);
    expect(t).toContain("482913");
    expect(t).not.toMatch(/<|>|&[a-z]+;|display:none|@import/i);
    expect(t).toContain("Help centre (https://outlly.test/help)");
    expect(t.split("\n").some((l) => l.length === 0)).toBe(true);
  });

  test("every template produces non-empty text without markup", () => {
    for (const [name, html] of Object.entries(sampleAll(mod))) {
      const t = mod.htmlToText(html);
      expect({ name, ok: t.length > 80 && !/<[a-z/!]/i.test(t) }).toEqual({ name, ok: true });
    }
  });
});

function sampleAll(m: typeof import("../lib/email")): Record<string, string> {
  return {
    otp: m.templates.otp({ name: null, code: "123456", minutes: 10 }),
    waitlistInvite: m.templates.waitlistInvite({ url: "https://outlly.test/signup?i=1", name: "Ravi" }),
    test: m.templates.test("resend"),
  };
}
