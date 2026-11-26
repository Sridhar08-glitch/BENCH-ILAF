import type { BookingSectionData } from "@/lib/public-api";
import { Glyph, SectionHead } from "./Head";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

const CAL = "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4";

/** The booking block: its title and the "Book a time" button. The calendar that opens from it is a separate client part. */
export function Booking({ data, ctx }: { data: BookingSectionData; ctx: SectionContext }) {
  const { t } = ctx;
  return (
    <section className={s.sec} data-section="booking">
      <SectionHead title={data.title || t("content.defBooking")} />
      <button type="button" className={`${s.btn} ${s.block}`} data-book={ctx.code}>
        <Glyph d={CAL} />{t("content.bookTime")}
      </button>
    </section>
  );
}
