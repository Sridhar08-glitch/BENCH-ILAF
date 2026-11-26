import type { PublicSection } from "@/lib/public-api";
import { orderSections } from "./helpers";
import { Booking } from "./Booking";
import { Event } from "./Event";
import { Gallery } from "./Gallery";
import { Hours } from "./Hours";
import { MapBlock } from "./Map";
import { Products } from "./Products";
import { Team } from "./Team";
import { Video } from "./Video";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

/** The sections that will be drawn: a video block only places the card's video, so without one there is nothing to draw. */
export function visibleSections(sections: PublicSection[] | null | undefined, videoUrl: string | null): PublicSection[] {
  return orderSections(sections).filter((sec) => sec.kind !== "video" || !!videoUrl);
}

/** Every section of a card in the owner's order. Drawn on the server; only the countdown and the buy buttons need scripts. */
export function Sections({ sections, ctx, now }: { sections: PublicSection[] | null | undefined; ctx: SectionContext; now?: Date }) {
  // A video block only places the card's video: without one there is nothing to draw.
  const list = visibleSections(sections, ctx.videoUrl);
  if (list.length === 0) return null;
  return (
    <div className={s.list} data-sections={list.length}>
      {list.map((sec) => {
        switch (sec.kind) {
          case "video": return <Video key={sec.id} data={sec.data} ctx={ctx} />;
          case "products": return <Products key={sec.id} data={sec.data} ctx={ctx} />;
          case "hours": return <Hours key={sec.id} data={sec.data} ctx={ctx} now={now} />;
          case "booking": return <Booking key={sec.id} data={sec.data} ctx={ctx} />;
          case "team": return <Team key={sec.id} data={sec.data} ctx={ctx} />;
          case "gallery": return <Gallery key={sec.id} data={sec.data} ctx={ctx} />;
          case "event": return <Event key={sec.id} data={sec.data} ctx={ctx} now={now} />;
          case "map": return <MapBlock key={sec.id} data={sec.data} ctx={ctx} />;
          default: return null;
        }
      })}
    </div>
  );
}
