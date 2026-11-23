import { describe, expect, it } from "vitest";
import * as si from "simple-icons";
import { brandFromHost, brandNameOfHost, buildLookup, hostOf, resolveIcon, type BrandEntry, type IconLookup } from "./brand";

// The real brand list, the same data the server uses.
const entries: BrandEntry[] = Object.values(si)
  .filter((v): v is (typeof si.siGithub) => typeof v === "object" && v !== null && "slug" in v)
  .map((v) => ({ slug: v.slug, title: v.title, hex: v.hex }));
const lk = buildLookup(entries);

describe("host of a typed value", () => {
  it("reads web addresses, bare domains and email domains", () => {
    expect(hostOf("https://www.nike.com/ae/")).toBe("www.nike.com");
    expect(hostOf("nike.com/shoes")).toBe("nike.com");
    expect(hostOf("me@gmail.com")).toBe("gmail.com");
    expect(hostOf("mailto:me@proton.me")).toBe("proton.me");
  });
  it("gives null for phone links and words", () => {
    expect(hostOf("tel:+97455551234")).toBeNull();
    expect(hostOf("hello")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("brand name of a host", () => {
  it("drops sub-domains and the extension", () => {
    expect(brandNameOfHost("www.shop.nike.com")).toBe("nike");
    expect(brandNameOfHost("bbc.co.uk")).toBe("bbc");
    expect(brandNameOfHost("github.com")).toBe("github");
  });
});

describe("domain to brand", () => {
  it("has the full brand list", () => {
    expect(entries.length).toBeGreaterThan(2500);
  });
  const cases: [string, string][] = [
    ["github.com", "github"], ["www.nike.com", "nike"], ["stripe.com", "stripe"], ["notion.so", "notion"],
    ["wa.me", "whatsapp"], ["t.me", "telegram"], ["youtu.be", "youtube"], ["fb.com", "facebook"],
    ["linktr.ee", "linktree"], ["maps.app.goo.gl", "googlemaps"], ["gmail.com", "gmail"], ["mail.proton.me", "protonmail"],
    ["open.spotify.com", "spotify"], ["twitter.com", "x"], ["discord.gg", "discord"],
    ["shopify.com", "shopify"], ["wise.com", "wise"], ["calendly.com", "calendly"],
  ];
  it.each(cases)("%s is %s", (host, slug) => {
    expect(brandFromHost(host, lk)?.slug).toBe(slug);
  });
  it("matches a brand whose title has spaces", () => {
    expect(brandFromHost("www.hellofresh.com", lk)?.slug).toBe("hellofresh");
  });
  it("gives null for an unknown site", () => {
    expect(brandFromHost("my-unknown-small-shop-xyz.com", lk)).toBeNull();
  });
});

describe("icon fallback order", () => {
  const fake: IconLookup = {
    brand: (slug) => (slug === "github" || slug === "gmail" ? { path: "M0", hex: "111111", title: slug } : null),
    detect: (host) => (host.endsWith("github.com") ? { slug: "github", title: "GitHub", hex: "181717" } : host === "gmail.com" ? { slug: "gmail", title: "Gmail", hex: "EA4335" } : null),
  };
  const item = (over: object) => ({ kind: "Custom", value: "example.com", ...over });

  it("1. the owner's uploaded image wins", () => {
    const r = resolveIcon(item({ icon: { type: "upload", key: "github", image_url: "http://x/i.png" } }), fake);
    expect(r).toEqual({ t: "image", url: "http://x/i.png" });
  });
  it("2. then the owner's chosen brand logo", () => {
    const r = resolveIcon(item({ icon: { type: "brand", key: "github", image_url: null } }), fake);
    expect(r.t).toBe("brand");
  });
  it("3. then the owner's chosen generic icon", () => {
    const r = resolveIcon(item({ icon: { type: "lucide", key: "heart", image_url: null } }), fake);
    expect(r).toEqual({ t: "lucide", key: "heart" });
  });
  it("a chosen brand that does not exist falls back to automatic", () => {
    const r = resolveIcon(item({ value: "github.com/me", icon: { type: "brand", key: "nope", image_url: null } }), fake);
    expect(r.t).toBe("brand");
  });
  it("4. automatic: a fixed platform keeps its own logo", () => {
    expect(resolveIcon({ kind: "Instagram", value: "x" }, fake)).toEqual({ t: "kind" });
  });
  it("5. automatic: a custom link uses the brand of its domain", () => {
    expect(resolveIcon(item({ value: "https://github.com/me" }), fake).t).toBe("brand");
    expect(resolveIcon(item({ value: "me@gmail.com" }), fake).t).toBe("brand");
  });
  it("an email at a company's own domain gets the mail icon, not the company logo", () => {
    const own: IconLookup = { ...fake, detect: (h) => (h === "nike.com" ? { slug: "github", title: "Nike", hex: "000000" } : null) };
    expect(resolveIcon(item({ value: "info@nike.com" }), own)).toEqual({ t: "lucide", key: "mail" });
  });
  it("6. automatic: other emails and phones get a mail or phone icon", () => {
    expect(resolveIcon(item({ value: "sales@unknownco.com" }), fake)).toEqual({ t: "lucide", key: "mail" });
    expect(resolveIcon(item({ value: "+974 5555 1234" }), fake)).toEqual({ t: "lucide", key: "phone" });
  });
  it("7. last: an unknown site gets the plain link icon", () => {
    expect(resolveIcon(item({ value: "unknown-site.example" }), fake)).toEqual({ t: "kind" });
    expect(resolveIcon(item({ icon: { type: "auto", key: null, image_url: null }, value: "unknown-site.example" }), fake)).toEqual({ t: "kind" });
  });
});
