"use client";

// The design picker, one step at a time: face, colours, text, layout below the card, opening animation, finish.
// Every choice goes through the editor's own update(), so saving works exactly as for the other tabs.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { designsApi } from "@/lib/designs/api";
import { CustomColours, CustomFaceGrid } from "./CustomFaces";
import type { CompanyFace } from "@/lib/library/custom/types";
import { Icon } from "@/components/Icon";
import { ToggleRow } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { CardView } from "@/components/card/CardView";
import { api } from "@/lib/api";
import { fontInfo, isFontLocked, FONT_FACE } from "@/lib/library/text";
import { BELOW_COUNT, COMPANY_COLOUR, FACE_COUNT, INTRO_COUNT, belowInfo, defaultDesign, faceInfo, introInfo, normalizeDesign } from "@/lib/library";
import type { CardPageData } from "@/lib/library/types";
import type { Design } from "@/lib/types";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import { cardLocale, dirOf, type MessageKey } from "@/lib/i18n";
import type { EditorApi } from "../types";
import {
  PAGE_SIZE, STEPS, TAGS, backStep, belowItems, faceItems, filterItems, firstStep, goToStep, introItems, isDone, nextStep, pad, pageOf, pagesToShow, paletteLabel, randomBetween,
  tagLabel, type Item, type StepState,
} from "./logic";
import { Scaled, Thumb } from "./Preview";
import { TextStep } from "./TextStep";
import s from "./design.module.css";

const MAX_COVER = 3 * 1024 * 1024;
/** Narrowest a grid cell may get; the grid then fits as many columns as the panel allows and shares the leftover width. */
const MIN_CELL = 128;
const GRID_GAP = 10;
const CELL_PAD = 14;

/** Columns and thumbnail width that fill a grid of the measured width exactly. */
function useGrid(): [React.RefObject<HTMLDivElement | null>, { cols: number; thumb: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ cols: 2, thumb: MIN_CELL - CELL_PAD });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const cols = Math.max(2, Math.floor((w + GRID_GAP) / (MIN_CELL + GRID_GAP)));
      const cell = Math.floor((w - GRID_GAP * (cols - 1)) / cols);
      setSize((o) => (o.cols === cols && o.thumb === cell - CELL_PAD ? o : { cols, thumb: cell - CELL_PAD }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function DesignWizard({ ed }: { ed: EditorApi }) {
  const { card, draft, update, icons } = ed;
  const { t, locale, number } = useI18n();
  const toast = useToast();
  const d = normalizeDesign(draft.design);
  // The company's own faces (live or approved); only this card's company is asked.
  const faceList = useQuery({ queryKey: ["custom-faces", card.workspace_id], queryFn: () => designsApi.faces(card.workspace_id), staleTime: 60000 });
  const faces: CompanyFace[] = faceList.data ?? [];
  const customFace = faces.find((f) => f.id === d.custom_face) ?? null;
  // The cards are drawn in the card's own language, or in the dashboard's when the card follows the visitor.
  const cardLang = cardLocale(draft.language ?? "auto", locale);
  const [st, setSt] = useState<StepState>(firstStep);
  const [localPlay, setLocalPlay] = useState(0);
  const headId = useId();
  const top = useRef<HTMLDivElement>(null);

  const set = (patch: Partial<Design>) => update({ design: { ...d, ...patch } });

  // What the cards are drawn with: the owner's own details, without the design.
  const base = useMemo<Omit<CardPageData, "design">>(
    () => ({
      name: draft.name, title: draft.title, company: draft.company, address: draft.address, photoUrl: card.photo_url, coverUrl: card.cover_url ?? null,
      publicUrl: card.public_url, saveContact: draft.save_contact, items: draft.items.map((it, i) => ({ ...it, res: icons[i] })), brand: ed.brand ?? null,
      locale: cardLang, customFace,
    }),
    [customFace, draft.name, draft.title, draft.company, draft.address, draft.save_contact, draft.items, icons, card.photo_url, card.cover_url, card.public_url, ed.brand, cardLang],
  );
  const preview = useMemo<CardPageData>(() => ({ ...base, design: d }), [base, d.face, d.custom_face, d.colour, d.below, d.intro, d.font, d.size, d.photo, d.brand_colors, d.foot]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = () => {
    ed.replay();
    setLocalPlay((n) => n + 1);
  };

  const move = (next: StepState) => {
    setSt(next);
    top.current?.scrollIntoView?.({ block: "nearest" });
  };

  const shuffle = () => {
    const face = randomBetween(1, FACE_COUNT);
    set({ face, colour: randomBetween(0, ed.brand?.palette ? COMPANY_COLOUR : 3), below: randomBetween(1, BELOW_COUNT), intro: randomBetween(1, INTRO_COUNT) });
    play();
  };

  const stepKey = STEPS[st.step].key;
  const titles: Record<string, [MessageKey, MessageKey]> = {
    face: ["editor.titleFace", "editor.textFace"],
    colour: ["editor.titleColour", "editor.textColour"],
    text: ["editor.titleText", "editor.textText"],
    below: ["editor.titleBelow", "editor.textBelow"],
    anim: ["editor.titleAnim", "editor.textAnim"],
    finish: ["editor.titleFinish", "editor.textFinish"],
  };

  return (
    <div className={s.wiz} ref={top}>
      <ol className={s.steps} aria-label={t("editor.stepsAria")}>
        {STEPS.map((x, i) => {
          const done = isDone(st, i);
          const current = i === st.step;
          return (
            <li key={x.key}>
              <button
                type="button"
                className={`${s.stepbtn} ${done ? s.done : ""}`}
                aria-current={current ? "step" : undefined}
                disabled={i > st.reached}
                onClick={() => move(goToStep(st, i))}
              >
                <span className={s.dot}>{done && !current ? <Icon name="check" size="s" /> : number(i + 1)}</span>
                <small>{t(x.label)}{done ? <span className="sr-only"> {t("editor.stepDone")}</span> : null}</small>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={s.head}>
        <div>
          <h3 id={headId} tabIndex={-1}>{t(titles[stepKey][0])}</h3>
          <p>{t(titles[stepKey][1])}</p>
        </div>
        {stepKey !== "text" && (
          <div className={s.peek} aria-label={t("editor.livePreview")} style={{ pointerEvents: "none" }}>
            <div className={s.box}>
              <Scaled width={96} ratio={1.4} dir={dirOf(cardLang)}>
                <CardView data={preview} mode="preview" playKey={localPlay} autoplay={stepKey === "anim"} />
              </Scaled>
            </div>
          </div>
        )}
      </div>

      <div role="group" aria-labelledby={headId}>
        {stepKey === "face" && <FaceStep base={base} d={d} faces={faces} onPick={(face) => set({ face, custom_face: null })} onPickCustom={(id) => set({ custom_face: id, colour: d.colour === 4 ? 4 : d.colour })} />}
        {stepKey === "colour" && <ColourStep base={base} d={d} customFace={customFace} onPick={(colour) => set({ colour })} />}
        {stepKey === "text" && <TextStep base={base} d={d} set={set} />}
        {stepKey === "below" && <BelowStep base={base} d={d} onPick={(below) => set({ below })} />}
        {stepKey === "anim" && <AnimStep d={d} onPick={(intro, replay) => { set({ intro }); if (replay) play(); }} onPlay={play} />}
        {stepKey === "finish" && <FinishStep ed={ed} d={d} set={set} toast={toast} onReset={() => update({ design: defaultDesign() })} />}
      </div>

      <div className={s.nav}>
        <button type="button" className="btn ghost sm" onClick={shuffle}><Icon name="tap" size="s" />{t("editor.shuffle")}</button>
        <div className={s.right}>
          <button type="button" className="btn ghost" disabled={st.step === 0} onClick={() => move(backStep(st))}>{t("common.back")}</button>
          {st.step < STEPS.length - 1 ? (
            <button type="button" className="btn" onClick={() => move(nextStep(st))}>{t("common.next")}</button>
          ) : (
            <button type="button" className="btn accent" onClick={() => { setSt((x) => ({ ...x, reached: STEPS.length })); toast(t("editor.designSaved")); }}>
              <Icon name="check" size="s" />{t("common.done")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Search box, optional tag filter and the "Show more" paging shared by the face and layout lists. */
function Browser({ items, selected, tags, thumb, label, onPick }: {
  items: Item[];
  selected: number;
  tags?: boolean;
  /** Which list this is; it picks the search and count texts. */
  label: "faces" | "layouts";
  thumb: (it: Item, width: number) => React.ReactNode;
  onPick: (n: number) => void;
}) {
  const { t, number, list } = useI18n();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [pages, setPages] = useState(() => pagesToShow(items, selected));
  const found = useMemo(() => filterItems(items, q, tag, (it) => it.tags.map((x) => tagLabel(x, t)).join(" ")), [items, q, tag, t]);
  const { shown, more } = pageOf(found, pages);
  const [gridRef, grid] = useGrid();
  const current = items.find((it) => it.n === selected);
  const search = label === "faces" ? t("editor.searchFaces") : t("editor.searchLayouts");
  const count = (label === "faces" ? t("editor.countFaces", { found: number(found.length), total: number(items.length) }) : t("editor.countLayouts", { found: number(found.length), total: number(items.length) }));
  return (
    <div className={s.tools}>
      <input type="search" dir="auto" aria-label={search} placeholder={search} value={q} onChange={(e) => { setQ(e.target.value); setPages(1); }} />
      {tags && (
        <div className={s.tags} role="group" aria-label={t("editor.filterStyle")}>
          {TAGS.map((x) => (
            <button key={x} type="button" className={s.tag} aria-pressed={tag === x} onClick={() => { setTag(tag === x ? null : x); setPages(1); }}>{tagLabel(x, t)}</button>
          ))}
        </div>
      )}
      <div className={s.count} role="status" aria-live="polite">{count}{current ? <> &middot; {t("editor.chosen", { num: pad(current.n), name: current.name })}</> : null}</div>
      {found.length === 0 ? (
        <div className={s.empty}>{t("editor.nothingMatchesFilter")}</div>
      ) : (
        <div className={s.grid} ref={gridRef} style={{ ["--cols" as string]: grid.cols }}>
          {shown.map((it) => (
            <button key={it.n} type="button" className={s.cell} aria-pressed={selected === it.n} onClick={() => onPick(it.n)}>
              {thumb(it, grid.thumb)}
              <span>
                <b><span className={s.num}>{pad(it.n)}</span>{it.name}</b>
                {it.description && it.tags.length === 0 && <small>{it.description}</small>}
                {it.tags.length > 0 && <small>{list(it.tags.map((x) => tagLabel(x, t)))}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
      {more > 0 && (
        <button type="button" className={`btn ghost ${s.more}`} onClick={() => setPages((p) => p + 1)}>{t("editor.showMore", { n: number(Math.min(more, PAGE_SIZE)), left: number(more) })}</button>
      )}
    </div>
  );
}

function FaceStep({ base, d, faces, onPick, onPickCustom }: { base: Omit<CardPageData, "design">; d: Design; faces: CompanyFace[]; onPick: (n: number) => void; onPickCustom: (id: number) => void }) {
  return (
    <>
    <CustomFaceGrid faces={faces} base={base} d={d} onPick={onPickCustom} />
    <Browser
      items={faceItems()} selected={d.face} tags label="faces" onPick={onPick}
      thumb={(it, w) => <Thumb base={base} face={it.n} colour={d.colour} below={d.below} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={w} ratio={1.15} />}
    />
    </>
  );
}

function ColourStep({ base, d, customFace, onPick }: { base: Omit<CardPageData, "design">; d: Design; customFace: CompanyFace | null; onPick: (i: number) => void }) {
  const { t } = useI18n();
  const info = faceInfo(d.face);
  const [gridRef, grid] = useGrid();
  const company = base.brand?.palette ?? null;
  return (
    <div className={s.tools}>
      <div className={s.count}>{t("editor.coloursOf", { name: info.name })}</div>
      <div className={s.swatches} ref={gridRef} style={{ ["--cols" as string]: grid.cols }} role="group" aria-label={t("editor.coloursMade")}>
        {company && (
          <button type="button" className={s.sw} aria-pressed={d.colour === COMPANY_COLOUR} aria-label={t("editor.companyColours")} onClick={() => onPick(COMPANY_COLOUR)}>
            <Thumb base={base} face={d.face} colour={COMPANY_COLOUR} below={d.below} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={grid.thumb - 4} ratio={1.15} />
            <span className={s.chips} aria-hidden="true">
              <i style={{ background: company.bg }} /><i style={{ background: company.bg2 }} /><i style={{ background: company.fg }} /><i style={{ background: company.acc }} />
            </span>
            <b>{t("editor.companyColours")}</b>
          </button>
        )}
        {!customFace && info.palettes.map((p, i) => (
          <button key={i} type="button" className={s.sw} aria-pressed={d.colour === i} aria-label={t("editor.coloursNamed", { name: paletteLabel(p.name, t) })} onClick={() => onPick(i)}>
            <Thumb base={base} face={d.face} colour={i} below={d.below} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={grid.thumb - 4} ratio={1.15} />
            <span className={s.chips} aria-hidden="true">
              <i style={{ background: p.bg }} /><i style={{ background: p.bg2 }} /><i style={{ background: p.fg }} /><i style={{ background: p.acc }} />
            </span>
            <b>{paletteLabel(p.name, t)}</b>
          </button>
        ))}
      </div>
      {customFace && <CustomColours face={customFace} base={base} d={d} onPick={onPick} />}
    </div>
  );
}

function BelowStep({ base, d, onPick }: { base: Omit<CardPageData, "design">; d: Design; onPick: (n: number) => void }) {
  return (
    <Browser
      items={belowItems()} selected={d.below} label="layouts" onPick={onPick}
      thumb={(it, w) => <Thumb base={base} face={d.face} colour={d.colour} below={it.n} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={w} ratio={1.9} />}
    />
  );
}

function AnimStep({ d, onPick, onPlay }: { d: Design; onPick: (n: number, replay: boolean) => void; onPlay: () => void }) {
  const { t, number } = useI18n();
  const [q, setQ] = useState("");
  const [pages, setPages] = useState(() => (d.intro > 0 ? pagesToShow(introItems(), d.intro) : 1));
  const found = useMemo(() => filterItems(introItems(), q), [q]);
  const { shown, more } = pageOf(found, pages);
  const none = q.trim() === "" || t("editor.noAnimation").toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div className={s.tools}>
      <input type="search" dir="auto" aria-label={t("editor.searchOpenings")} placeholder={t("editor.searchOpenings")} value={q} onChange={(e) => { setQ(e.target.value); setPages(1); }} />
      <div className={s.count} role="status" aria-live="polite">{t("editor.countOpenings", { found: number(found.length), total: number(INTRO_COUNT) })}</div>
      <div className={s.list}>
        {none && (
          <div className={s.row} data-on={d.intro === 0}>
            <button type="button" className={s.pick} aria-pressed={d.intro === 0} onClick={() => onPick(0, false)}>{t("editor.noAnimation")}</button>
          </div>
        )}
        {shown.map((it) => (
          <div key={it.n} className={s.row} data-on={d.intro === it.n}>
            <button type="button" className={s.pick} aria-pressed={d.intro === it.n} onClick={() => onPick(it.n, true)}>
              <span className={s.num}>{pad(it.n)}</span>{it.name}
            </button>
            <button type="button" className="btn ghost sm" aria-label={t("editor.playNamed", { name: it.name })} onClick={() => (d.intro === it.n ? onPlay() : onPick(it.n, true))}>
              <Icon name="eye" size="s" />{t("editor.play")}
            </button>
          </div>
        ))}
      </div>
      {found.length === 0 && !none && <div className={s.empty}>{t("editor.nothingMatches")}</div>}
      {more > 0 && (
        <button type="button" className={`btn ghost ${s.more}`} onClick={() => setPages((p) => p + 1)}>{t("editor.showMore", { n: number(Math.min(more, PAGE_SIZE)), left: number(more) })}</button>
      )}
    </div>
  );
}

function FinishStep({ ed, d, set, toast, onReset }: { ed: EditorApi; d: Design; set: (p: Partial<Design>) => void; toast: (m: string) => void; onReset: () => void }) {
  const { card } = ed;
  const { t, number } = useI18n();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const face = faceInfo(d.face);
  const mb = number(MAX_COVER / (1024 * 1024));

  async function onCover(f: File | undefined) {
    if (!f) return;
    if (!isAllowedImage(f)) return toast(t("common.useImage"));
    if (f.size > MAX_COVER) return toast(t("editor.pictureTooLarge", { mb }));
    setBusy(true);
    try {
      const r = await api.uploadCover(card.id, f);
      ed.setCover(r.cover_url);
      toast(t("editor.coverUpdated"));
    } catch (e) {
      toast(apiErrorText(e, t, "editor.coverFailed"));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="pane">
      <dl className={s.sum} aria-label={t("editor.choices")}>
        <dt>{t("editor.sumFace")}</dt><dd>{pad(d.face)} {face.name}</dd>
        <dt>{t("editor.sumColours")}</dt><dd>{d.colour === COMPANY_COLOUR ? t("editor.companyColours") : paletteLabel(face.palettes[d.colour]?.name ?? "", t)}</dd>
        <dt>{t("editor.sumFont")}</dt>
        <dd>{d.font === FONT_FACE ? t("editor.fontOwn") : (fontInfo(d.font)?.name ?? t("editor.fontOwn"))}{isFontLocked(d.face) ? <> &middot; {t("editor.fontLocked")}</> : null}</dd>
        <dt>{t("editor.sumSize")}</dt><dd>{t("editor.percent", { n: number(d.size) })}</dd>
        <dt>{t("editor.sumBelow")}</dt><dd>{pad(d.below)} {belowInfo(d.below).name}</dd>
        <dt>{t("editor.sumOpening")}</dt><dd>{d.intro === 0 ? t("editor.noAnimation") : `${pad(d.intro)} ${introInfo(d.intro).name}`}</dd>
      </dl>

      <div>
        <ToggleRow first title={t("editor.showPhoto")} hint={t("editor.showPhotoHint")} checked={d.photo} onChange={(v) => set({ photo: v })} />
        <ToggleRow title={t("editor.brandColours")} hint={t("editor.brandColoursHint")} checked={d.brand_colors} onChange={(v) => set({ brand_colors: v })} />
        <ToggleRow title={t("editor.showFooter")} hint={t("editor.showFooterHint")} checked={d.foot} onChange={(v) => set({ foot: v })} />
      </div>

      {ed.canCover && (
        <div className="pane" style={{ gap: 8 }}>
          <div className="sechead"><Icon name="camera" size="s" />{t("editor.coverHead")}</div>
          <div className="photo">
            <div className="av" style={{ borderRadius: 8, width: 90, height: 56, background: "var(--surface-2)", color: "var(--mute)" }} aria-hidden="true">
              {card.cover_url ? <img src={card.cover_url} alt="" /> : <Icon name="camera" />}
            </div>
            <div>
              <input ref={file} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => void onCover(e.target.files?.[0])} />
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => file.current?.click()}><Icon name="upload" size="s" />{busy ? t("editor.uploading") : t("editor.coverUpload")}</button>
              <div className="hint" style={{ marginBlockStart: 6 }}>{t("editor.coverHint", { mb })}</div>
            </div>
          </div>
        </div>
      )}

      <button type="button" className="btn ghost" onClick={onReset}>{t("editor.resetDesign")}</button>
    </div>
  );
}
