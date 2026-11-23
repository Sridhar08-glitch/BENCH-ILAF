// The company brand page as a guided flow: which steps there are, where the owner is, which steps are done,
// when leaving needs a warning, and the plain summary shown on the last step. Pure functions, no screen code.
import { belowInfo, faceInfo, introInfo, COMPANY_COLOUR } from "@/lib/library";
import { tk, type I18n, type MessageKey } from "@/lib/i18n";
import type { FullBrand } from "./state";

export type StepId = "company" | "colours" | "logo" | "artwork" | "style" | "finish";

export interface StepDef {
  id: StepId;
  title: MessageKey;
  /** One line under the step title. */
  hint: MessageKey;
}

const ALL: StepDef[] = [
  { id: "company", title: tk("brand.stepCompany"), hint: tk("brand.stepCompanyHint") },
  { id: "colours", title: tk("brand.stepColours"), hint: tk("brand.stepColoursHint") },
  { id: "logo", title: tk("brand.stepLogo"), hint: tk("brand.stepLogoHint") },
  { id: "artwork", title: tk("brand.stepArtwork"), hint: tk("brand.stepArtworkHint") },
  { id: "style", title: tk("brand.stepStyle"), hint: tk("brand.stepStyleHint") },
  { id: "finish", title: tk("brand.stepFinish"), hint: tk("brand.stepFinishHint") },
];

/** A company goes through all six steps; a personal workspace only has the ones that apply to it. */
export function stepsFor(company: boolean): StepDef[] {
  return company ? ALL : ALL.filter((s) => s.id === "company" || s.id === "style" || s.id === "finish");
}

export interface Flow {
  index: number;
  /** Positions of the steps the owner has been on (the current one included). */
  visited: number[];
}

export function startFlow(): Flow {
  return { index: 0, visited: [0] };
}

function clamp(i: number, count: number): number {
  return Math.min(Math.max(0, Math.trunc(i)), Math.max(0, count - 1));
}

/** Jump to a step. Steps the owner has left are marked done. */
export function goTo(f: Flow, i: number, count: number): Flow {
  const index = clamp(i, count);
  return { index, visited: f.visited.includes(index) ? f.visited : [...f.visited, index] };
}

export const nextStep = (f: Flow, count: number): Flow => goTo(f, f.index + 1, count);
export const backStep = (f: Flow, count: number): Flow => goTo(f, f.index - 1, count);
export const isFirst = (f: Flow): boolean => f.index === 0;
export const isLast = (f: Flow, count: number): boolean => f.index >= count - 1;

/** The steps that show a tick: visited and not the one on screen. */
export function isDone(f: Flow, i: number): boolean {
  return i !== f.index && f.visited.includes(i);
}

/** Leaving the page with unsaved changes, or while a save is running, needs a warning. */
export function shouldWarnOnLeave(dirty: boolean, saving: boolean): boolean {
  return dirty || saving;
}

/** What the "Next" button says: Done on the last step. */
export function nextLabel(f: Flow, count: number, t: I18n["t"]): string {
  return isLast(f, count) ? t("common.done") : t("common.next");
}

export interface SummaryRow {
  label: string;
  value: string;
}

const DISPLAY: Record<string, MessageKey> = { auto: tk("brand.logoAuto"), full: tk("brand.logoFull"), symbol: tk("brand.logoSymbol"), symbol_name: tk("brand.logoSymbolName") };
const PLACEMENT: Record<string, MessageKey> = { both: tk("brand.placeBoth"), card: tk("brand.placeCard"), above: tk("brand.placeAbove") };
const CORNER: Record<string, MessageKey> = { auto: tk("brand.cornerAuto"), tl: tk("brand.cornerTl"), tr: tk("brand.cornerTr"), bl: tk("brand.cornerBl"), br: tk("brand.cornerBr") };
const CHIP: Record<string, MessageKey> = { auto: tk("brand.chipAuto"), always: tk("brand.chipAlways"), never: tk("brand.chipNever"), white: tk("brand.chipWhite"), black: tk("brand.chipBlack") };
const MODE: Record<string, MessageKey> = { none: tk("brand.modeColours"), background: tk("brand.modeBackground"), pattern: tk("brand.modePattern"), template: tk("brand.modeTemplate") };
const CARD_MODE: Record<string, MessageKey> = { light: tk("brand.cardLight"), dark: tk("brand.cardDark") };

/** Every choice in plain words, for the Finish step. */
export function summaryRows(b: FullBrand, workspaceName: string, company: boolean, i18n: Pick<I18n, "t" | "number">, country = ""): SummaryRow[] {
  const { t, number } = i18n;
  const word = (map: Record<string, MessageKey>, key: string) => (map[key] ? t(map[key]) : key);
  const rows: SummaryRow[] = [
    { label: t("brand.companyNameOnCards"), value: (b.company_name || workspaceName).trim() || t("brand.sumNotSet") },
    { label: t("brand.website"), value: b.website.trim() || t("brand.sumNotSet") },
    { label: t("brand.slotLogo"), value: b.logo_url ? t("brand.sumUploaded") : t("brand.sumNoneYet") },
  ];
  if (company) {
    rows.push({ label: t("brand.sumCountry"), value: country.trim() || t("brand.sumNotSet") });
    rows.push({ label: t("brand.sumSymbol"), value: b.symbol_url ? t("brand.sumUploaded") : t("brand.sumSymbolNone") });
    const c = b.colours;
    const primary = c?.primary.toUpperCase() ?? "";
    const accent = c?.accent.toUpperCase() ?? "";
    rows.push({
      label: t("brand.sumColours"),
      value: !c ? t("brand.sumNotUsed")
        : c.mode === "brand" ? t("brand.sumColoursValueOwn", { primary, accent })
        : t("brand.sumColoursValue", { primary, accent, mode: word(CARD_MODE, c.mode) }),
    });
    const display = word(DISPLAY, b.logo_display);
    rows.push({ label: t("brand.sumLogoShows"), value: b.show_company_name ? t("brand.sumWithName", { display }) : display });
    rows.push({ label: t("brand.sumPlacement"), value: t("brand.sumPlacementValue", { placement: word(PLACEMENT, b.logo_placement), corner: word(CORNER, b.logo_corner) }) });
    rows.push({ label: t("brand.sumBacking"), value: word(CHIP, b.logo_chip) });
    rows.push({ label: t("brand.sumAppears"), value: word(MODE, b.artwork.mode) });
  }
  const d = b.design;
  rows.push({ label: t("brand.sumFace"), value: `${number(d.face)}. ${faceInfo(d.face).name}` });
  rows.push({ label: t("brand.sumCardColours"), value: d.colour === COMPANY_COLOUR ? t("brand.sumCompanyColours") : (faceInfo(d.face).palettes[d.colour]?.name ?? t("brand.sumFaceColours")) });
  rows.push({ label: t("brand.sumBelow"), value: `${number(d.below)}. ${belowInfo(d.below).name}` });
  rows.push({ label: t("brand.sumOpening"), value: d.intro === 0 ? t("common.none") : `${number(d.intro)}. ${introInfo(d.intro).name}` });
  rows.push({ label: t("brand.sumLocked"), value: b.lock_design ? t("common.yes") : t("brand.sumLockedNo") });
  rows.push({ label: t("brand.sumPowered"), value: b.show_footer ? t("brand.sumShown") : t("brand.sumHidden") });
  return rows;
}
