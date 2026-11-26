// The sections rendered to static markup with fixture data, as the public page does on the server.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createI18n } from "@/lib/i18n";
import { CATALOGUES } from "@/lib/i18n/messages";
import type { PublicSection } from "@/lib/public-api";
import { Sections } from "./Sections";
import { Hours } from "./Hours";
import { Event } from "./Event";
import { Products } from "./Products";
import { MapBlock } from "./Map";
import type { SectionContext } from "./types";

const ctxOf = (locale: "en" | "ar" = "en", extra: Partial<SectionContext> = {}): SectionContext => ({
  t: createI18n(locale, "latn", CATALOGUES[locale]).t,
  locale,
  code: "sara",
  publicUrl: "https://ilaf.one/c/sara",
  name: "Sara Al Mansoori",
  videoUrl: "https://cdn.example/v.mp4",
  posterUrl: "https://cdn.example/p.jpg",
  ...extra,
});

const product = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Product ${id}`, description: "A fine thing", price: "320.00", currency: "QAR", image_url: `https://cdn.example/${id}.jpg`, badge: "", meta: {}, stock: null, ...extra,
});

export const FIXTURE: PublicSection[] = [
  { id: "s1", kind: "video", order: 0, data: { title: "Watch my intro" } },
  { id: "s2", kind: "products", order: 1, data: { title: "Shop", layout: "grid", items: [product("a", { badge: "New" }), product("b", { stock: 0 }), product("c"), product("d")] } },
  { id: "s3", kind: "hours", order: 2, data: { title: "", timezone: "Asia/Qatar", days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, open: "08:00", close: "20:00", closed: d === 4 })), note: "Closed on public holidays" } },
  { id: "s4", kind: "map", order: 3, data: { title: "Find the clinic", address: "Al Sadd, Building 14\nDoha, Qatar", maps_url: "https://maps.app.goo.gl/x", directions_note: "12 min" } },
  { id: "s5", kind: "team", order: 4, data: { title: "", cards: [
    { code: "k", name: "Khalid Nasser", title: "Engineering", photo_url: null, url: "https://ilaf.one/c/k" },
    { code: "m", name: "Maryam Ali", title: "Marketing", photo_url: "https://cdn.example/m.jpg", url: "https://ilaf.one/c/m" },
  ] } },
  { id: "s6", kind: "gallery", order: 5, data: { title: "Portfolio", images: [
    { id: "g2", url: "https://cdn.example/g2.jpg", caption: "Motion", order: 1 },
    { id: "g1", url: "https://cdn.example/g1.jpg", caption: "Brand", order: 0 },
  ] } },
  { id: "s7", kind: "event", order: 6, data: { title: "", event_name: "Web Summit Qatar", starts_at: "2026-12-01T09:00:00Z", ends_at: null, venue: "DECC", hall: "Hall 2", stand: "B14", talk_title: "", talk_time: "", slides_url: "" } },
  { id: "s8", kind: "booking", order: 7, data: { title: "" } },
];

const NOW = new Date("2026-11-24T07:00:00Z");

describe("Sections", () => {
  it("draws every kind in the owner's order with the page's words", () => {
    const html = renderToStaticMarkup(createElement(Sections, { sections: FIXTURE, ctx: ctxOf(), now: NOW }));
    const order = [...html.matchAll(/data-section="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["video", "products", "hours", "map", "team", "gallery", "event", "booking"]);
    expect(html).toContain('data-sections="8"');
    expect(html).toContain("Watch my intro");
    expect(html).toContain('poster="https://cdn.example/p.jpg"');
    expect(html.toLowerCase()).toContain("playsinline");
    expect(html).toContain('preload="metadata"');
    expect(html).toContain("Opening hours");
    expect(html).toContain("Meet the team");
    expect(html).toContain("Book a time");
    expect(html).toContain('data-book="sara"');
  });

  it("draws nothing without sections and skips a video block when the card has no video", () => {
    expect(renderToStaticMarkup(createElement(Sections, { sections: [], ctx: ctxOf() }))).toBe("");
    const html = renderToStaticMarkup(createElement(Sections, { sections: FIXTURE.slice(0, 1), ctx: ctxOf("en", { videoUrl: null }) }));
    expect(html).toBe("");
  });

  it("speaks Arabic when the card does", () => {
    const html = renderToStaticMarkup(createElement(Sections, { sections: FIXTURE, ctx: ctxOf("ar"), now: NOW }));
    expect(html).toContain("ساعات العمل");
    expect(html).toContain("تعرّف على الفريق");
    expect(html).toContain("الاثنين");
  });
});

describe("Products", () => {
  const data = FIXTURE[1].data as Extract<PublicSection, { kind: "products" }>["data"];

  it("grid: two-column cards with price, badge, sold-out and buy buttons that name the product", () => {
    const html = renderToStaticMarkup(createElement(Products, { data, ctx: ctxOf() }));
    expect(html).toContain('data-layout="grid"');
    expect(html).toContain("QAR 320");
    expect(html).toContain(">New<");
    expect(html).toContain("Sold out");
    expect(html).toContain('data-product="a"');
    expect((html.match(/<button/g) ?? []).length).toBe(3);
    expect(html).toContain("4 items");
  });

  it("carousel, menu and listings each have their own markup", () => {
    const carousel = renderToStaticMarkup(createElement(Products, { data: { ...data, layout: "carousel" }, ctx: ctxOf() }));
    expect(carousel).toContain('data-layout="carousel"');
    expect(carousel).toContain("Swipe");
    const menu = renderToStaticMarkup(createElement(Products, { data: { ...data, layout: "menu", items: [product("x", { meta: { category: "Coffee" }, badge: "Chef's pick" }), product("y", { meta: { category: "Breakfast" } })] }, ctx: ctxOf() }));
    expect(menu).toContain('data-layout="menu"');
    expect(menu).toContain(">Coffee<");
    expect(menu).toContain(">Breakfast<");
    expect(menu).toContain("Chef&#x27;s pick");
    const listings = renderToStaticMarkup(createElement(Products, { data: { ...data, layout: "listings", items: [product("h", { price: "2450000", badge: "New", meta: { beds: 3, baths: 4, size: "240 m²" } })] }, ctx: ctxOf() }));
    expect(listings).toContain('data-layout="listings"');
    expect(listings).toContain("<small>QAR</small>2,450,000");
    expect(listings).toContain("240 m²");
    expect(listings).toContain("Enquire");
  });

  it("draws nothing without products", () => {
    expect(renderToStaticMarkup(createElement(Products, { data: { title: "", layout: "grid", items: [] }, ctx: ctxOf() }))).toBe("");
  });
});

describe("Hours", () => {
  const data = FIXTURE[2].data as Extract<PublicSection, { kind: "hours" }>["data"];

  it("marks today in the place's zone and says open or closed", () => {
    // 07:00 UTC on a Tuesday is 10:00 in Doha: open until 20:00; Tuesday is in the Monday-to-Thursday run.
    const html = renderToStaticMarkup(createElement(Hours, { data, ctx: ctxOf(), now: NOW }));
    expect(html).toContain("Open until 20:00");
    expect(html).toContain("Monday to Thursday");
    expect(html).toContain(">Today<");
    expect(html).toContain(">Friday<");
    expect(html).toContain(">Closed<");
    expect(html).toContain("Closed on public holidays");
    // Friday 12:00 in Doha: closed, no opening later.
    const fri = renderToStaticMarkup(createElement(Hours, { data, ctx: ctxOf(), now: new Date("2026-11-27T09:00:00Z") }));
    expect(fri).toContain("Closed now");
    // Monday 05:00 UTC = 08:00 in Doha: opens at 08:00? no, at 08:00 it is open; 04:00 UTC = 07:00 Doha opens later.
    const early = renderToStaticMarkup(createElement(Hours, { data, ctx: ctxOf(), now: new Date("2026-11-23T04:00:00Z") }));
    expect(early).toContain("Opens at 08:00");
  });
});

describe("Event", () => {
  const data = FIXTURE[6].data as Extract<PublicSection, { kind: "event" }>["data"];

  it("counts down before the start with the stand facts and a calendar file", () => {
    const html = renderToStaticMarkup(createElement(Event, { data, ctx: ctxOf(), now: NOW }));
    expect(html).toContain("Web Summit Qatar");
    expect(html).toContain('data-state="before"');
    expect(html).toContain("Starts in");
    expect(html).toContain("<b>07</b>");
    expect(html).toContain("Hall 2 · B14");
    expect(html).toContain("Find my stand");
    expect(html).toContain("DECC");
    expect(html).toContain('download="event.ics"');
    expect(html).toContain("data:text/calendar");
  });

  it("shows the session when the owner speaks, and the slides link only over https", () => {
    const speaker = { ...data, talk_title: "Designing for a bilingual Gulf", talk_time: "11:30 – 12:10", slides_url: "https://slides.example/deck" };
    const html = renderToStaticMarkup(createElement(Event, { data: speaker, ctx: ctxOf(), now: NOW }));
    expect(html).toContain("Designing for a bilingual Gulf");
    expect(html).toContain("11:30 – 12:10");
    expect(html).toContain('href="https://slides.example/deck"');
    expect(html).not.toContain("Find my stand");
    const bad = renderToStaticMarkup(createElement(Event, { data: { ...speaker, slides_url: "http://slides.example" }, ctx: ctxOf(), now: NOW }));
    expect(bad).not.toContain("slides.example");
  });

  it("says live during the event and ended after it", () => {
    expect(renderToStaticMarkup(createElement(Event, { data, ctx: ctxOf(), now: new Date("2026-12-01T12:00:00Z") }))).toContain('data-state="live"');
    expect(renderToStaticMarkup(createElement(Event, { data, ctx: ctxOf(), now: new Date("2026-12-05T12:00:00Z") }))).toContain("This event has ended");
  });
});

describe("Map", () => {
  it("draws the tile with the first address line, the note on the button, and no outside map", () => {
    const data = FIXTURE[3].data as Extract<PublicSection, { kind: "map" }>["data"];
    const html = renderToStaticMarkup(createElement(MapBlock, { data, ctx: ctxOf() }));
    expect(html).toContain("Al Sadd");
    expect(html).toContain("Get directions · 12 min");
    expect(html).toContain('href="https://maps.app.goo.gl/x"');
    expect(html).not.toContain("<iframe");
    const noLink = renderToStaticMarkup(createElement(MapBlock, { data: { ...data, maps_url: "http://maps" }, ctx: ctxOf() }));
    expect(noLink).not.toContain("Get directions");
  });
});

describe("Team and Gallery", () => {
  it("shows initials without a photo and sorts pictures by order", () => {
    const html = renderToStaticMarkup(createElement(Sections, { sections: FIXTURE.slice(4, 6), ctx: ctxOf() }));
    expect(html).toContain("KN");
    expect(html).toContain('src="https://cdn.example/m.jpg"');
    expect(html).toContain("2 people");
    expect(html.indexOf("g1.jpg")).toBeLessThan(html.indexOf("g2.jpg"));
    expect(html).toContain("<figcaption");
  });
});
