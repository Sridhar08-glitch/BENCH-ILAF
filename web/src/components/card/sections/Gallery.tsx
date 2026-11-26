import type { GallerySectionData } from "@/lib/public-api";
import { SectionHead } from "./Head";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

/** Up to nine pictures in a three-up grid; a caption sits on the picture, and a tap opens the full picture. */
export function Gallery({ data, ctx }: { data: GallerySectionData; ctx: SectionContext }) {
  const { t } = ctx;
  const images = (Array.isArray(data.images) ? data.images : []).filter((i) => i && i.url).slice().sort((a, b) => a.order - b.order);
  if (images.length === 0) return null;
  return (
    <section className={s.sec} data-section="gallery">
      <SectionHead title={data.title || t("content.defGallery")} big />
      <div className={s.gallery}>
        {images.map((img) => (
          <a key={img.id} className={s.gi} href={img.url} target="_blank" rel="noopener noreferrer">
            <figure style={{ margin: 0, height: "100%" }}>
              <img src={img.url} alt={img.caption || ""} loading="lazy" />
              {img.caption && <figcaption dir="auto">{img.caption}</figcaption>}
            </figure>
          </a>
        ))}
      </div>
    </section>
  );
}
