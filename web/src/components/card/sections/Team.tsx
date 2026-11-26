import type { TeamSectionData } from "@/lib/public-api";
import { initials } from "@/lib/card/design";
import { SectionHead } from "./Head";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

/** Colleagues' cards in a three-up grid: photo or initials, name and title, each a link to that card. */
export function Team({ data, ctx }: { data: TeamSectionData; ctx: SectionContext }) {
  const { t } = ctx;
  const people = Array.isArray(data.cards) ? data.cards.filter((p) => p && typeof p === "object" && p.name) : [];
  if (people.length === 0) return null;
  return (
    <section className={s.sec} data-section="team">
      <SectionHead title={data.title || t("content.defTeam")} right={<span className={s.count}>{t("content.people", { n: people.length })}</span>} />
      <div className={s.team}>
        {people.map((p) => (
          <a key={p.code} className={s.tm} href={p.url} data-member={p.code}>
            <span className={s.av} aria-hidden="true">{p.photo_url ? <img src={p.photo_url} alt="" loading="lazy" /> : initials(p.name)}</span>
            <b dir="auto">{p.name}</b>
            {p.title && <span dir="auto">{p.title}</span>}
          </a>
        ))}
      </div>
    </section>
  );
}
