import type { MapSectionData } from "@/lib/public-api";
import { safeHttps } from "./helpers";
import { Glyph, SectionHead } from "./Head";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

const DIRECTIONS = "M12 2l10 10-10 10L2 12zM9 12h6l-2-2M15 12l-2 2";

/** A drawn map tile (no outside map is loaded): the address as a label, a pin, and a button that opens the owner's maps link. */
export function MapBlock({ data, ctx }: { data: MapSectionData; ctx: SectionContext }) {
  const { t } = ctx;
  const link = safeHttps(data.maps_url) ? data.maps_url.trim() : null;
  const firstLine = (data.address || "").split(/\r?\n|,/)[0]?.trim();
  const button = data.directions_note ? t("content.directionsWith", { note: data.directions_note }) : t("content.directions");
  return (
    <section className={s.sec} data-section="map">
      <SectionHead title={data.title || t("content.defMap")} />
      <div className={s.map} role="img" aria-label={data.address || data.title || t("content.defMap")}>
        {firstLine && <span className={s.lbl} dir="auto">{firstLine}</span>}
        <svg className={s.pin} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 24s8-7.4 8-13.5A8 8 0 1 0 4 10.5C4 16.6 12 24 12 24z" /></svg>
        {link && (
          <a className={`${s.btn} ${s.ink} ${s.sm} ${s.dir}`} href={link} target="_blank" rel="noopener noreferrer">
            <Glyph d={DIRECTIONS} strokeWidth={2.4} />{button}
          </a>
        )}
      </div>
      {data.address && <p className={s.addr} dir="auto">{data.address}</p>}
    </section>
  );
}
