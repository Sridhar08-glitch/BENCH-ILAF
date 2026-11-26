import type { ProductsSectionData, PublicProduct } from "@/lib/public-api";
import { formatPrice, groupByCategory, listingFacts, productsOf } from "./helpers";
import { Glyph, SectionHead } from "./Head";
import { ProductBuy } from "./ProductBuy";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

const BAG = "M3 4h2l2.4 11h11.2L21 7H7M9 20a1.4 1.4 0 1 0 0 .1M17 20a1.4 1.4 0 1 0 0 .1";
const BED = "M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 14h18M6 9V6h5v3";
const BATH = "M4 12h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM6 12V5a2 2 0 0 1 4 0";
const AREA = "M4 4h16v16H4zM4 12h16M12 4v16";

/** The products of a card in one of four looks: a two-column grid, a swipe row, a menu with price lines, or listing rows. */
export function Products({ data, ctx }: { data: ProductsSectionData; ctx: SectionContext }) {
  const items = productsOf(data);
  if (items.length === 0) return null;
  const { t } = ctx;
  const title = data.title || t("content.defProducts");
  const layout = data.layout;
  const count = <span className={s.count}><Glyph d={BAG} />{t("content.items", { n: items.length })}</span>;

  if (layout === "menu") {
    return (
      <section className={s.sec} data-section="products" data-layout="menu">
        <SectionHead title={title} big right={count} />
        <div className={`${s.panel} ${s.menu}`}>
          {groupByCategory(items).map((g) => (
            <div key={g.category || "_"}>
              {g.category && <div className={s.cat} dir="auto">{g.category}</div>}
              {g.items.map((p) => (
                <div key={p.id} className={s.mi} data-product={p.id}>
                  <div className={s.body}>
                    <b dir="auto">{p.title}</b>
                    {p.description && <small dir="auto">{p.description}</small>}
                    {p.badge && <span className={s.pick}>{p.badge}</span>}
                  </div>
                  <div className={s.side}>
                    <span className={`${s.price} ${s.mono}`}>{formatPrice(p.price, p.currency, ctx.locale)}</span>
                    <ProductBuy code={ctx.code} product={p} label={t("content.add")} small soldOut={t("content.soldOut")} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (layout === "listings") {
    return (
      <section className={s.sec} data-section="products" data-layout="listings">
        <SectionHead title={title} right={count} />
        {items.map((p) => {
          const f = listingFacts(p.meta);
          return (
            <div key={p.id} className={s.listing} data-product={p.id}>
              <div className={s.ph}>
                {p.badge && <span className={s.badge}>{p.badge}</span>}
                {p.image_url && <img src={p.image_url} alt="" loading="lazy" />}
              </div>
              <div className={s.pb}>
                <Price p={p} locale={ctx.locale} big />
                <span className={s.name} dir="auto">{p.title}</span>
                {(f.beds || f.baths || f.size) && (
                  <div className={s.facts}>
                    {f.beds && <span title={t("content.beds")}><Glyph d={BED} />{f.beds}</span>}
                    {f.baths && <span title={t("content.baths")}><Glyph d={BATH} />{f.baths}</span>}
                    {f.size && <span title={t("content.size")}><Glyph d={AREA} />{f.size}</span>}
                  </div>
                )}
                <div><ProductBuy code={ctx.code} product={p} label={t("content.enquire")} small soldOut={t("content.soldOut")} /></div>
              </div>
            </div>
          );
        })}
      </section>
    );
  }

  const carousel = layout === "carousel";
  return (
    <section className={s.sec} data-section="products" data-layout={carousel ? "carousel" : "grid"}>
      <SectionHead title={title} big right={carousel ? <span className={s.swipe}>{t("content.swipe")}</span> : count} />
      <div className={carousel ? s.carousel : s.grid}>
        {items.map((p) => (
          <div key={p.id} className={s.pd} data-product={p.id}>
            <div className={s.art}>
              {p.badge && <span className={s.badge}>{p.badge}</span>}
              {p.image_url && <img src={p.image_url} alt="" loading="lazy" />}
            </div>
            <div className={s.tx}>
              <b dir="auto">{p.title}</b>
              {p.description && <small dir="auto">{p.description}</small>}
              <Price p={p} locale={ctx.locale} />
              <ProductBuy code={ctx.code} product={p} label={t("content.buy")} small soldOut={t("content.soldOut")} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Price({ p, locale, big }: { p: PublicProduct; locale: string; big?: boolean }) {
  const text = formatPrice(p.price, p.currency, locale);
  if (!text) return null;
  if (!big) return <span className={`${s.price} ${s.mono}`}>{text}</span>;
  const [code, ...rest] = text.split(" ");
  return <span className={s.big}><small>{code}</small>{rest.join(" ") || code}</span>;
}
