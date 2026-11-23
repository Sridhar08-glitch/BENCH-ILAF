"use client";

// "Your company's designs": the custom faces made for this company, shown at the top of the Face step, and their
// colourways in the Colour step. Only faces of the card's own company ever arrive here (the API sends no others).
import { useMemo } from "react";
import { CardView } from "@/components/card/CardView";
import { useI18n } from "@/lib/i18n/client";
import { defaultDesign } from "@/lib/library";
import type { CompanyFace } from "@/lib/library/custom/types";
import type { CardPageData } from "@/lib/library/types";
import type { Design } from "@/lib/types";
import { dirOf } from "@/lib/i18n";
import { Scaled } from "./Preview";
import s from "./design.module.css";

type Base = Omit<CardPageData, "design">;

function CustomThumb({ base, face, colour, d, width, ratio }: { base: Base; face: CompanyFace; colour: number; d: Design; width: number; ratio: number }) {
  const data = useMemo<CardPageData>(
    () => ({ ...base, customFace: face, design: { ...defaultDesign(), ...d, custom_face: face.id, colour, intro: 0 } }),
    [base, face, colour, d],
  );
  return (
    <div aria-hidden="true">
      <Scaled width={width} ratio={ratio} dir={dirOf(data.locale ?? "en")}><CardView data={data} mode="thumb" autoplay={false} /></Scaled>
    </div>
  );
}

export function CustomFaceGrid({ faces, base, d, onPick }: { faces: CompanyFace[]; base: Base; d: Design; onPick: (id: number) => void }) {
  const { t } = useI18n();
  if (!faces.length) return null;
  return (
    <section aria-label={t("designs.yourDesigns")} style={{ marginBlockEnd: 16 }}>
      <div className={s.count}>{t("designs.yourDesigns")}</div>
      <div className={s.swatches} role="group" aria-label={t("designs.yourDesigns")}>
        {faces.map((f) => (
          <button key={f.id} type="button" className={s.sw} aria-pressed={d.custom_face === f.id} onClick={() => onPick(f.id)}>
            <CustomThumb base={base} face={f} colour={d.colour === 4 ? 0 : d.colour} d={d} width={150} ratio={1.15} />
            <b>{f.name}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The four colourways of the chosen custom face (colour 4, the company colours, stays in the Colour step's own list). */
export function CustomColours({ face, base, d, onPick }: { face: CompanyFace; base: Base; d: Design; onPick: (i: number) => void }) {
  const { t } = useI18n();
  return (
    <div className={s.swatches} role="group" aria-label={t("designs.colourways")}>
      {face.palettes.map((p, i) => (
        <button key={i} type="button" className={s.sw} aria-pressed={d.colour === i} aria-label={p.name} onClick={() => onPick(i)}>
          <CustomThumb base={base} face={face} colour={i} d={d} width={120} ratio={1.15} />
          <span className={s.chips} aria-hidden="true"><i style={{ background: p.bg }} /><i style={{ background: p.bg2 }} /><i style={{ background: p.fg }} /><i style={{ background: p.acc }} /></span>
          <b>{p.name}</b>
        </button>
      ))}
    </div>
  );
}
