import type { VideoSectionData } from "@/lib/public-api";
import { SectionHead } from "./Head";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

/** The card's uploaded video: a 16:9 player with the poster picture, played by the browser itself. */
export function Video({ data, ctx }: { data: VideoSectionData; ctx: SectionContext }) {
  if (!ctx.videoUrl) return null;
  return (
    <section className={s.sec} data-section="video">
      <SectionHead title={data.title || ctx.t("content.defVideo")} big />
      <div className={s.video}>
        <video controls playsInline preload="metadata" poster={ctx.posterUrl ?? undefined} src={ctx.videoUrl} aria-label={data.title || ctx.t("content.defVideo")} />
        <span className={s.tag}><i />{ctx.t("content.introTag")}</span>
      </div>
    </section>
  );
}
