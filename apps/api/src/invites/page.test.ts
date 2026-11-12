import { describe, expect, it } from "vitest";
import { escapeHtml, pickLanguage, renderInvitePage } from "./page.js";

const invite = {
  projectName: "Chuyến đi Đà Lạt",
  inviterName: "Lan",
  code: "ABCD2345",
  expiresAt: new Date("2026-11-19T10:00:00Z"),
};

describe("pickLanguage", () => {
  it.each([
    ["en-US,en;q=0.9", "en"],
    ["en", "en"],
    ["vi", "vi"],
    [undefined, "vi"],
    ["", "vi"],
    ["en;q=0.5,vi;q=0.8", "vi"],
    ["vi;q=0.5,en;q=0.8", "en"],
    ["en,vi", "vi"],
    ["fr,de;q=0.7", "vi"],
    [";;;,,q=,en;q=abc", "vi"],
    ["\u0000garbage;;;==", "vi"],
  ])("%j gives %s", (header, expected) => {
    expect(pickLanguage(header)).toBe(expected);
  });
});

describe("escapeHtml", () => {
  it("escapes & < > \" and '", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("renderInvitePage", () => {
  it("renders the Vietnamese page with project, inviter, formatted code and date", () => {
    const html = renderInvitePage({ lang: "vi", invite, installUrl: null });
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain("Chuyến đi Đà Lạt");
    expect(html).toContain("Lan");
    expect(html).toContain("ABCD-2345");
    expect(html).toContain("19/11/2026");
    expect(html).toContain("Tham gia bằng mã");
    expect(html).toContain('name="viewport"');
    expect(html).not.toContain("<script");
  });

  it("renders English with a Vietnam-timezone date", () => {
    const html = renderInvitePage({ lang: "en", invite, installUrl: null });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("19 Nov 2026");
    expect(html).toContain("Join with code");
    // 18:00 UTC on the 30th is already the 1st in Asia/Ho_Chi_Minh.
    const late = renderInvitePage({
      lang: "en",
      invite: { ...invite, expiresAt: new Date("2026-11-30T18:00:00Z") },
      installUrl: null,
    });
    expect(late).toContain("1 Dec 2026");
  });

  it("escapes project and inviter names", () => {
    const html = renderInvitePage({
      lang: "vi",
      invite: {
        ...invite,
        projectName: `<script>alert(1)</script> "q" 'a'`,
        inviterName: `<img src=x onerror=1>"'`,
      },
      installUrl: null,
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot; &#39;a&#39;");
    expect(html).toContain("&lt;img src=x onerror=1&gt;&quot;&#39;");
  });

  it("uses a neutral fallback when the inviter is gone", () => {
    const html = renderInvitePage({
      lang: "en",
      invite: { ...invite, inviterName: null },
      installUrl: null,
    });
    expect(html).toContain("Someone");
    expect(html).not.toContain("null");
  });

  it("links the install step only when installUrl is set", () => {
    const without = renderInvitePage({ lang: "en", invite, installUrl: null });
    expect(without).not.toContain("<a ");
    expect(without).toContain("ask the person who invited you");
    const withUrl = renderInvitePage({
      lang: "en",
      invite,
      installUrl: "https://example.com/app?a=1&b=2",
    });
    expect(withUrl).toContain('<a href="https://example.com/app?a=1&amp;b=2"');
    expect(withUrl).not.toContain("ask the person who invited you");
  });

  it("renders one generic page per language with nothing about an invite", () => {
    const vi = renderInvitePage({ lang: "vi", invite: null, installUrl: "https://example.com/x" });
    const en = renderInvitePage({ lang: "en", invite: null, installUrl: "https://example.com/x" });
    expect(vi).toContain('<html lang="vi">');
    expect(en).toContain('<html lang="en">');
    expect(vi).not.toBe(en);
    expect(vi).not.toContain("example.com");
    expect(en).not.toContain("<a ");
    expect(en).not.toContain("<script");
  });
});
