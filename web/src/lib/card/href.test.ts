import { describe, expect, it } from "vitest";
import { hrefFor, isSafeHref, mapsSearchUrl, opensInNewTab } from "./href";

describe("phone and SMS", () => {
  it("builds tel links without spaces, dashes or brackets, keeping the leading +", () => {
    expect(hrefFor("Mobile", "+971 50 123-4567")).toBe("tel:+971501234567");
    expect(hrefFor("Landline", "(04) 331 9655")).toBe("tel:043319655");
    expect(hrefFor("Mobile", "tel:+44 20 7946 0958")).toBe("tel:+442079460958");
  });
  it("builds sms links the same way", () => {
    expect(hrefFor("SMS", "+974 5555-1234")).toBe("sms:+97455551234");
  });
  it("gives no link for an empty or unsafe number", () => {
    expect(hrefFor("Mobile", "")).toBeNull();
    expect(hrefFor("Mobile", "abc")).toBeNull();
    expect(hrefFor("Mobile", "javascript:alert(1)")).toBeNull();
  });
});

describe("WhatsApp", () => {
  it("uses digits only and drops +", () => {
    expect(hrefFor("WhatsApp", "+971 50 669 8770")).toBe("https://wa.me/971506698770");
  });
  it("drops a leading 00", () => {
    expect(hrefFor("WhatsApp", "00971506698770")).toBe("https://wa.me/971506698770");
  });
  it("keeps a typed wa.me link", () => {
    expect(hrefFor("WhatsApp", "wa.me/971506698770")).toBe("https://wa.me/971506698770");
  });
  it("gives no link without digits", () => {
    expect(hrefFor("WhatsApp", "call me")).toBeNull();
  });
});

describe("email", () => {
  it("builds mailto", () => {
    expect(hrefFor("Email", "info@example.com")).toBe("mailto:info@example.com");
    expect(hrefFor("Email", "mailto:info@example.com")).toBe("mailto:info@example.com");
  });
  it("rejects spaces and other schemes", () => {
    expect(hrefFor("Email", "a b@example.com")).toBeNull();
    expect(hrefFor("Email", "javascript:alert(1)")).toBeNull();
  });
});

describe("location", () => {
  it("opens a typed link as it is", () => {
    expect(hrefFor("Location", "https://maps.google.com/?q=Deira")).toBe("https://maps.google.com/?q=Deira");
    expect(hrefFor("Location", "maps.app.goo.gl/abc123")).toBe("https://maps.app.goo.gl/abc123");
  });
  it("turns plain text into a maps search", () => {
    expect(hrefFor("Location", "Deira, Dubai")).toBe("https://www.google.com/maps/search/?api=1&query=Deira%2C%20Dubai");
  });
  it("the address line uses the same maps search", () => {
    expect(mapsSearchUrl("Al Yasmin Building, Dubai")).toBe("https://www.google.com/maps/search/?api=1&query=Al%20Yasmin%20Building%2C%20Dubai");
    expect(mapsSearchUrl("  ")).toBeNull();
  });
});

describe("web links", () => {
  it("adds https when no scheme is typed", () => {
    expect(hrefFor("Website", "jascorps.com")).toBe("https://jascorps.com");
    expect(hrefFor("Calendly", "calendly.com/me")).toBe("https://calendly.com/me");
    expect(hrefFor("AppStore", "apps.apple.com/app/id1")).toBe("https://apps.apple.com/app/id1");
    expect(hrefFor("GooglePlay", "play.google.com/store/apps/details?id=x")).toBe("https://play.google.com/store/apps/details?id=x");
    expect(hrefFor("PayPal", "paypal.me/me")).toBe("https://paypal.me/me");
    expect(hrefFor("Custom", "example.org/page")).toBe("https://example.org/page");
  });
  it("keeps http and https as typed", () => {
    expect(hrefFor("Website", "http://example.com")).toBe("http://example.com");
    expect(hrefFor("Website", "HTTPS://example.com")).toBe("HTTPS://example.com");
  });
});

describe("social handles", () => {
  const cases: [string, string, string][] = [
    ["Instagram", "@jas", "https://instagram.com/jas"],
    ["Facebook", "jas", "https://facebook.com/jas"],
    ["X", "@jas", "https://x.com/jas"],
    ["TikTok", "jas", "https://tiktok.com/@jas"],
    ["LinkedIn", "jas", "https://linkedin.com/in/jas"],
    ["YouTube", "jas", "https://youtube.com/@jas"],
    ["Snapchat", "jas", "https://snapchat.com/add/jas"],
    ["Telegram", "@jas", "https://t.me/jas"],
    ["GitHub", "jas", "https://github.com/jas"],
    ["Behance", "jas", "https://behance.net/jas"],
    ["Dribbble", "jas", "https://dribbble.com/jas"],
    ["Pinterest", "jas", "https://pinterest.com/jas"],
    ["Threads", "@jas", "https://threads.net/@jas"],
    ["Twitch", "jas", "https://twitch.tv/jas"],
    ["Reddit", "jas", "https://reddit.com/u/jas"],
    ["Medium", "@jas", "https://medium.com/@jas"],
    ["SoundCloud", "jas", "https://soundcloud.com/jas"],
  ];
  it.each(cases)("%s handle %s becomes a profile link", (kind, typed, expected) => {
    expect(hrefFor(kind, typed)).toBe(expected);
  });
  it("keeps dots inside a handle", () => {
    expect(hrefFor("Instagram", "john.doe")).toBe("https://instagram.com/john.doe");
  });
  it("uses a typed full link or domain with https", () => {
    expect(hrefFor("Instagram", "instagram.com/jascorps")).toBe("https://instagram.com/jascorps");
    expect(hrefFor("LinkedIn", "https://www.linkedin.com/company/jas")).toBe("https://www.linkedin.com/company/jas");
    expect(hrefFor("X", "x.com")).toBe("https://x.com");
  });
  it("Spotify and Discord need a full link", () => {
    expect(hrefFor("Spotify", "myname")).toBeNull();
    expect(hrefFor("Spotify", "open.spotify.com/artist/1")).toBe("https://open.spotify.com/artist/1");
    expect(hrefFor("Discord", "discord.gg/abc")).toBe("https://discord.gg/abc");
  });
});

describe("unsafe schemes", () => {
  const bad = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com",
  ];
  const kinds = ["Website", "Custom", "Instagram", "Facebook", "Location", "Calendly", "PayPal", "Spotify", "WhatsApp"];
  for (const kind of kinds) {
    it(`${kind} refuses every unsafe scheme`, () => {
      for (const v of bad) {
        const out = hrefFor(kind, v);
        expect(out === null || isSafeHref(out)).toBe(true);
        if (out) expect(out).not.toMatch(/^(javascript|data|vbscript|file|ftp):/i);
      }
      expect(hrefFor(kind, "javascript:alert(1)")).toBeNull();
    });
  }
  it("isSafeHref only allows the five schemes", () => {
    for (const ok of ["http://a.com", "https://a.com", "tel:+1", "mailto:a@b.c", "sms:+1"]) expect(isSafeHref(ok)).toBe(true);
    for (const no of ["javascript:1", "data:text/plain,1", "vbscript:1", "file:///x", "", null, undefined]) expect(isSafeHref(no)).toBe(false);
  });
});

describe("opening behaviour", () => {
  it("web links open in a new tab, the rest open normally", () => {
    expect(opensInNewTab("https://a.com")).toBe(true);
    expect(opensInNewTab("http://a.com")).toBe(true);
    expect(opensInNewTab("tel:+1")).toBe(false);
    expect(opensInNewTab("mailto:a@b.c")).toBe(false);
    expect(opensInNewTab("sms:+1")).toBe(false);
  });
});

describe("custom values", () => {
  it("turns an email into mailto and a phone number into tel", () => {
    expect(hrefFor("Custom", "sales@example.com")).toBe("mailto:sales@example.com");
    expect(hrefFor("Custom", "+974 5555 1234")).toBe("tel:+97455551234");
    expect(hrefFor("Custom", "(04) 331-9655")).toBe("tel:043319655");
  });
  it("gives a bare domain https and keeps typed web links", () => {
    expect(hrefFor("Custom", "shop.example.com/menu")).toBe("https://shop.example.com/menu");
    expect(hrefFor("Custom", "https://linktr.ee/me")).toBe("https://linktr.ee/me");
    expect(hrefFor("Custom", "example.com:8080/path")).toBe("https://example.com:8080/path");
  });
  it("allows the extra app schemes", () => {
    for (const v of ["skype:live:me", "tg://resolve?domain=me", "viber://chat?number=%2B97455551234", "facetime:me@example.com", "facetime-audio:+97455551234", "geo:25.2,55.3"]) {
      expect(hrefFor("Custom", v)).toBe(v);
      expect(isSafeHref(v)).toBe(true);
    }
  });
  it("app links do not open in a new tab", () => {
    expect(opensInNewTab("skype:live:me")).toBe(false);
    expect(opensInNewTab("tg://resolve?domain=me")).toBe(false);
  });
  it("gives no link for unknown schemes or text with spaces", () => {
    for (const v of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///x", "blob:https://a.com/1", "ftp://a.com", "market://details?id=x"]) {
      expect(hrefFor("Custom", v)).toBeNull();
    }
    expect(hrefFor("Custom", "hello world")).toBeNull();
    expect(hrefFor("Custom", "")).toBeNull();
  });
});
