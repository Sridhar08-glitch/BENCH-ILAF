"use client";

// The design picker, one step at a time: face, colours, text, layout below the card, opening animation, finish.
// Every choice goes through the editor's own update(), so saving works exactly as for the other tabs.
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { designsApi } from "@/lib/designs/api";
import { CustomColours, CustomFaceGrid } from "./CustomFaces";
import type { CompanyFace } from "@/lib/library/custom/types";
import { Icon } from "@/components/Icon";
import { ToggleRow } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { CardView } from "@/components/card/CardView";
import { fontInfo, isFontLocked, FONT_FACE } from "@/lib/library/text";
import { COMPANY_COLOUR, FACE_COUNT, INTRO_COUNT, belowInfo, belowOfTop, defaultDesign, faceInfo, introInfo, normalizeDesign } from "@/lib/library";
import type { CardPageData } from "@/lib/library/types";
import type { Design } from "@/lib/types";
import { useFlags } from "@/lib/flags";
import { usePlans, useWorkspaceDetail } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import { cardLocale, dirOf } from "@/lib/i18n";
import type { EditorApi } from "../types";
import {
  PACK1_COUNT, PACK1_INTRO_COUNT, PAGE_SIZE, STEP_TITLES, TAGS, TOP_STYLES, TOP_STYLE_LABELS, backStep, belowForTop, type StepKey, belowItems, filterItems, firstStep, goToStep, introForTop, introItems, isDone,
  nextStep, offeredBelowCount, offeredFaces, packOf, pad, pageOf, pagesToShow, paletteLabel, randomBetween, tagLabel, topItemsIn, visibleSteps, type Item, type StepState, type TopStyle,
} from "./logic";
import { FREE_LIMIT, isFreePlan, richPagesAllowed } from "../ContentTab";
import { Scaled, Thumb } from "./Preview";
import { fieldsOf } from "@/lib/library/fieldsUsed";
import { CoverUpload } from "./CoverUpload";
import { TextStep } from "./TextStep";
import s from "./design.module.css";

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

/** `only` limits the wizard to some of its steps (the guided editor uses it); `onFinish` and `onBack` are called from the last and first of them. */
export interface WizardScope {
  only?: readonly StepKey[];
  onFinish?: () => void;
  onBack?: () => void;
}

export function DesignWizard({ ed, only, onFinish, onBack }: { ed: EditorApi } & WizardScope) {
  const { card, draft, update, icons } = ed;
  const { t, locale, number } = useI18n();
  const toast = useToast();
  const d = normalizeDesign(draft.design);
  // The company's own faces (live or approved); only this card's company is asked.
  const faceList = useQuery({ queryKey: ["custom-faces", card.workspace_id], queryFn: () => designsApi.faces(card.workspace_id), staleTime: 60000 });
  const faces: CompanyFace[] = faceList.data ?? [];
  const customFace = faces.find((f) => f.id === d.custom_face) ?? null;
  // Design Pack 2 (faces 401 to 500) can be switched off by the product team; the picker then offers the first 400 only.
  const flags = useFlags(card.workspace_id) as Record<string, boolean>;
  const pack2 = flags.pack2_faces;
  // Page styles (photo headers and their layouts 401 to 427) can be switched off by the product team, and belong to the paid plans.
  const pageStyles = flags.page_styles ?? true;
  const ws = useWorkspaceDetail(card.workspace_id);
  const plans = usePlans();
  const paid = richPagesAllowed(ws.data?.subscription, plans.data);
  // The free plan (the 7-day trial) offers the first 50 faces, below-card layouts and animations, and no page styles.
  const free = isFreePlan(ws.data?.kind, ws.data?.subscription);
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
  const preview = useMemo<CardPageData>(() => ({ ...base, design: d }), [base, d.face, d.custom_face, d.colour, d.top, d.below, d.intro, d.font, d.size, d.photo, d.brand_colors, d.foot]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = () => {
    ed.replay();
    setLocalPlay((n) => n + 1);
  };

  const move = (next: StepState) => {
    setSt(next);
    top.current?.scrollIntoView?.({ block: "nearest" });
  };

  const shuffle = () => {
    const face = randomBetween(1, free ? FREE_LIMIT : pack2 ? FACE_COUNT : PACK1_COUNT);
    set({ face, colour: randomBetween(0, ed.brand?.palette ? COMPANY_COLOUR : 3), below: d.top > 0 ? belowOfTop(d.top) : randomBetween(1, free ? FREE_LIMIT : offeredBelowCount(pageStyles && paid)), intro: d.top > 0 ? randomBetween(PACK1_INTRO_COUNT + 1, INTRO_COUNT) : randomBetween(1, PACK1_INTRO_COUNT) });
    play();
  };

  const all = visibleSteps(pageStyles, d.top);
  // Without a limit the picker starts with the card faces. The page styles (headers) are a second kind of look, chosen with the switch above the steps.
  const kindSwitch = !only && pageStyles;
  const steps = only ? all.filter((x) => only.includes(x.key)) : kindSwitch && d.top === 0 ? all.filter((x) => x.key !== "top") : all;
  const setKind = (page: boolean) => {
    if (page === d.top > 0) return;
    const top = page ? 1 : 0;
    set({ top, below: belowForTop(top, d.below), intro: introForTop(top, d.intro) });
    setSt(firstStep());
  };
  const stepKey = steps[Math.min(st.step, steps.length - 1)].key;
  const titles = STEP_TITLES;

  return (
    <div className={s.wiz} ref={top}>
      {kindSwitch && (
        <div className="row" role="group" aria-label={t("editor.gsLookKind")} style={{ marginBlockEnd: 8 }}>
          <button type="button" className={d.top === 0 ? "btn sm" : "btn ghost sm"} aria-pressed={d.top === 0} onClick={() => setKind(false)}>{t("editor.gsLookFace")}</button>
          <button type="button" className={d.top > 0 ? "btn sm" : "btn ghost sm"} aria-pressed={d.top > 0} onClick={() => setKind(true)}>{t("editor.gsLookPage")}</button>
        </div>
      )}
      {steps.length > 1 && <ol className={s.steps} aria-label={t("editor.stepsAria")}>
        {steps.map((x, i) => {
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
      </ol>}

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
        {stepKey === "top" && <TopStep base={base} d={d} locked={!paid} onPick={(n) => set({ top: n, below: belowForTop(n, d.below), intro: introForTop(n, d.intro) })} />}
        {stepKey === "face" && <FaceStep base={base} d={d} faces={faces} pack2={pack2} free={free} onPick={(face) => set({ face, custom_face: null })} onPickCustom={(id) => set({ custom_face: id, colour: d.colour === 4 ? 4 : d.colour })} />}
        {stepKey === "colour" && <ColourStep base={base} d={d} customFace={customFace} onPick={(colour) => set({ colour })} />}
        {stepKey === "text" && <TextStep base={base} d={d} set={set} />}
        {stepKey === "below" && <BelowStep base={base} d={d} pageStyles={pageStyles} locked={!paid} free={free} onPick={(below) => set({ below })} />}
        {stepKey === "anim" && <AnimStep header={d.top > 0} d={d} free={free} onPick={(intro, replay) => { set({ intro }); if (replay) play(); }} onPlay={play} />}
        {stepKey === "finish" && <FinishStep ed={ed} d={d} set={set} guided={!!only} onReset={() => update({ design: defaultDesign() })} />}
      </div>

      <div className={s.nav}>
        <button type="button" className="btn ghost sm" onClick={shuffle}><Icon name="tap" size="s" />{t("editor.shuffle")}</button>
        <div className={s.right}>
          <button type="button" className="btn ghost" disabled={st.step === 0 && !onBack} onClick={() => (st.step === 0 ? onBack?.() : move(backStep(st)))}>{t("common.back")}</button>
          {st.step < steps.length - 1 ? (
            <button type="button" className="btn" onClick={() => move(nextStep(st, steps.length))}>{t("common.next")}</button>
          ) : onFinish ? (
            <button type="button" className="btn" onClick={onFinish}>{t("common.next")}</button>
          ) : (
            <button type="button" className="btn accent" onClick={() => { setSt((x) => ({ ...x, reached: steps.length })); toast(t("editor.designSaved")); }}>
              <Icon name="check" size="s" />{t("common.done")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Search box, optional tag and pack filters and the "Show more" paging shared by the face and layout lists. */
function Browser({ items, selected, tags, packs, thumb, label, onPick, locked }: {
  items: Item[];
  selected: number;
  /** true offers the style tags (corporate, bold ...); a list offers those tags instead (the app patterns of the Top step). */
  tags?: boolean | readonly string[];
  /** Offer the Pack 1 / Pack 2 chips and mark the Pack 2 faces as new. */
  packs?: boolean;
  /** Which list this is; it picks the search and count texts. */
  label: "faces" | "layouts" | "headers";
  thumb: (it: Item, width: number) => React.ReactNode;
  onPick: (n: number) => void;
  /** Items the owner cannot choose yet (they need a paid plan): shown with a lock, not clickable. */
  locked?: (it: Item) => boolean;
}) {
  const { t, number, list } = useI18n();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [pages, setPages] = useState(() => pagesToShow(items, selected));
  const found = useMemo(() => filterItems(items, q, tag, (it) => it.tags.map((x) => tagLabel(x, t)).join(" ")), [items, q, tag, t]);
  const { shown, more } = pageOf(found, pages);
  const [gridRef, grid] = useGrid();
  const current = items.find((it) => it.n === selected);
  const search = label === "faces" ? t("editor.searchFaces") : label === "headers" ? t("editor.searchHeaders") : t("editor.searchLayouts");
  const counts = { found: number(found.length), total: number(items.length) };
  const count = label === "faces" ? t("editor.countFaces", counts) : label === "headers" ? t("editor.countHeaders", counts) : t("editor.countLayouts", counts);
  const tagList: readonly string[] = typeof tags === "object" ? tags : TAGS;
  const chip = (x: string) => (x in TOP_STYLE_LABELS ? t(TOP_STYLE_LABELS[x as TopStyle]) : tagLabel(x, t));
  return (
    <div className={s.tools}>
      <input type="search" dir="auto" aria-label={search} placeholder={search} value={q} onChange={(e) => { setQ(e.target.value); setPages(1); }} />
      {tags && (
        <div className={s.tags} role="group" aria-label={t("editor.filterStyle")}>
          
          {tags && tagList.map((x) => (
            <button key={x} type="button" className={s.tag} aria-pressed={tag === x} onClick={() => { setTag(tag === x ? null : x); setPages(1); }}>{chip(x)}</button>
          ))}
        </div>
      )}
      <div className={s.count} role="status" aria-live="polite">{count}{current ? <> &middot; {t("editor.chosen", { num: pad(current.n), name: current.name })}</> : null}</div>
      {found.length === 0 ? (
        <div className={s.empty}>{t("editor.nothingMatchesFilter")}</div>
      ) : (
        <div className={s.grid} ref={gridRef} style={{ ["--cols" as string]: grid.cols }}>
          {shown.map((it) => (
            <button key={it.n} type="button" className={s.cell} aria-pressed={selected === it.n} disabled={locked?.(it)} title={locked?.(it) ? t("editor.needsPlan") : undefined} onClick={() => onPick(it.n)}>
              {thumb(it, grid.thumb)}
              <span>
                <b>{locked?.(it) && <Icon name="lock" size="s" />}<span className={s.num}>{pad(it.n)}</span>{it.name}{packs && packOf(it.n) === 2 && <em className={s.new}>{t("editor.newFace")}</em>}</b>
                {it.description && it.tags.length === 0 && <small>{it.description}</small>}
                {it.tags.length > 0 && <small>{list(it.tags.map(chip))}</small>}
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

/** The first step: the card as it always was ("classic"), or one of the page-style headers (app patterns and hand-made design families). */
function TopStep({ base, d, locked, onPick }: { base: Omit<CardPageData, "design">; d: Design; locked: boolean; onPick: (n: number) => void }) {
  const { t, locale } = useI18n();
  const items = useMemo(() => topItemsIn(locale), [locale]);
  return (
    <>
      <div className={s.list}>
        <div className={s.row} data-on={d.top === 0}>
          <button type="button" className={s.pick} aria-pressed={d.top === 0} onClick={() => onPick(0)}>
            <b>{t("editor.classicHeader")}</b> <small>{t("editor.classicHeaderText")}</small>
          </button>
        </div>
      </div>
      {locked && (
        <p className="hint" role="note">
          <Icon name="lock" size="s" /> {t("editor.topPaidNote")} <Link href="/app/billing">{t("shell.seePlans")}</Link>
        </p>
      )}
      <Browser
        items={items} selected={d.top} tags={TOP_STYLES} label="headers" locked={() => locked} onPick={onPick}
        thumb={(it, w) => <Thumb base={base} face={d.face} colour={d.colour} top={it.n} below={belowForTop(it.n, d.below)} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={w} ratio={1.4} />}
      />
    </>
  );
}

function FaceStep({ base, d, faces, pack2, free, onPick, onPickCustom }: {
  base: Omit<CardPageData, "design">; d: Design; faces: CompanyFace[]; pack2: boolean; free: boolean; onPick: (n: number) => void; onPickCustom: (id: number) => void;
}) {
  const items = useMemo(() => offeredFaces(pack2), [pack2]);
  return (
    <>
    {free && <FreeNote />}
    <CustomFaceGrid faces={faces} base={base} d={d} onPick={onPickCustom} />
    <Browser
      items={items} selected={d.face} tags packs={pack2} label="faces" locked={(it) => free && it.n > FREE_LIMIT} onPick={onPick}
      thumb={(it, w) => <Thumb base={base} face={it.n} colour={d.colour} top={d.top} below={d.below} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={w} ratio={1.15} />}
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
            <Thumb base={base} face={d.face} colour={COMPANY_COLOUR} top={d.top} below={d.below} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={grid.thumb - 4} ratio={1.15} />
            <span className={s.chips} aria-hidden="true">
              <i style={{ background: company.bg }} /><i style={{ background: company.bg2 }} /><i style={{ background: company.fg }} /><i style={{ background: company.acc }} />
            </span>
            <b>{t("editor.companyColours")}</b>
          </button>
        )}
        {!customFace && info.palettes.map((p, i) => (
          <button key={i} type="button" className={s.sw} aria-pressed={d.colour === i} aria-label={t("editor.coloursNamed", { name: paletteLabel(p.name, t) })} onClick={() => onPick(i)}>
            <Thumb base={base} face={d.face} colour={i} top={d.top} below={d.below} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={grid.thumb - 4} ratio={1.15} />
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

/** Shown on the free plan: what it includes and where to get the rest. */
function FreeNote() {
  const { t } = useI18n();
  return (
    <p className="hint" role="note">
      <Icon name="lock" size="s" /> {t("editor.freeNote")} <Link href="/app/billing">{t("shell.seePlans")}</Link>
    </p>
  );
}

function BelowStep({ base, d, pageStyles, locked, free, onPick }: { base: Omit<CardPageData, "design">; d: Design; pageStyles: boolean; locked: boolean; free: boolean; onPick: (n: number) => void }) {
  // Layouts 401 to 427 are the page styles' own button sets: Pack 2, offered while page styles are on, for paid plans.
  const items = useMemo(() => belowItems(pageStyles), [pageStyles]);
  return (
    <Browser
      items={items} selected={d.below} label="layouts" packs={pageStyles} locked={(it) => (locked && it.n > PACK1_COUNT) || (free && it.n > FREE_LIMIT)} onPick={onPick}
      thumb={(it, w) => <Thumb base={base} face={d.face} colour={d.colour} top={d.top} below={it.n} photo={d.photo} brand_colors={d.brand_colors} foot={d.foot} font={d.font} size={d.size} width={w} ratio={1.9} />}
    />
  );
}

function AnimStep({ d, header, free, onPick, onPlay }: { d: Design; header: boolean; free: boolean; onPick: (n: number, replay: boolean) => void; onPlay: () => void }) {
  const { t, number } = useI18n();
  const [q, setQ] = useState("");
  const [pages, setPages] = useState(() => (d.intro > 0 ? pagesToShow(introItems(header), d.intro) : 1));
  const found = useMemo(() => filterItems(introItems(header), q), [q, header]);
  const { shown, more } = pageOf(found, pages);
  const none = q.trim() === "" || t("editor.noAnimation").toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div className={s.tools}>
      <input type="search" dir="auto" aria-label={t("editor.searchOpenings")} placeholder={t("editor.searchOpenings")} value={q} onChange={(e) => { setQ(e.target.value); setPages(1); }} />
      <div className={s.count} role="status" aria-live="polite">{t("editor.countOpenings", { found: number(found.length), total: number(introItems(header).length) })}</div>
      <div className={s.list}>
        {none && (
          <div className={s.row} data-on={d.intro === 0}>
            <button type="button" className={s.pick} aria-pressed={d.intro === 0} onClick={() => onPick(0, false)}>{t("editor.noAnimation")}</button>
          </div>
        )}
        {shown.map((it) => (
          <div key={it.n} className={s.row} data-on={d.intro === it.n}>
            <button type="button" className={s.pick} aria-pressed={d.intro === it.n} disabled={free && it.n > FREE_LIMIT} title={free && it.n > FREE_LIMIT ? t("editor.needsPlan") : undefined} onClick={() => onPick(it.n, true)}>
              {free && it.n > FREE_LIMIT && <Icon name="lock" size="s" />}<span className={s.num}>{pad(it.n)}</span>{it.name}
            </button>
            <button type="button" className="btn ghost sm" disabled={free && it.n > FREE_LIMIT} aria-label={t("editor.playNamed", { name: it.name })} onClick={() => (d.intro === it.n ? onPlay() : onPick(it.n, true))}>
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

function FinishStep({ ed, d, set, onReset, guided }: { ed: EditorApi; d: Design; set: (p: Partial<Design>) => void; onReset: () => void; guided: boolean }) {
  const { t, number } = useI18n();
  const face = faceInfo(d.face);
  // Only the options this design has: a photo switch for a design that draws a photo, a cover upload for one that draws a cover.
  // The guided editor asks for the cover in the Details step.
  const uses = fieldsOf(d);

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
        {uses.photo && <ToggleRow first title={t("editor.showPhoto")} hint={t("editor.showPhotoHint")} checked={d.photo} onChange={(v) => set({ photo: v })} />}
        <ToggleRow first={!uses.photo} title={t("editor.brandColours")} hint={t("editor.brandColoursHint")} checked={d.brand_colors} onChange={(v) => set({ brand_colors: v })} />
        <ToggleRow title={t("editor.showFooter")} hint={t("editor.showFooterHint")} checked={d.foot} onChange={(v) => set({ foot: v })} />
      </div>

      {ed.canCover && uses.cover && !guided && <CoverUpload ed={ed} />}

      <button type="button" className="btn ghost" onClick={onReset}>{t("editor.resetDesign")}</button>
    </div>
  );
}
