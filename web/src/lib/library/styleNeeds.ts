// What a style asks the owner for, worked out from the design's own data (fieldsUsed / fields.ts, made by rendering every
// design) so no style is hand-coded: which details it draws, which of them the card still lacks, and how many buttons it
// draws. Pure, so the editor panel and the tests share it.
import { TOP_SLOTS } from "./fields";
import { fieldsOf, unusedFields, type DesignFields } from "./fieldsUsed";
import { TOP_COUNT } from "./index";
import type { Design } from "@/lib/types";

/** What the card holds now. */
export interface CardHas {
  title: string;
  company: string;
  address: string;
  bio: string;
  photo: boolean;
  cover: boolean;
  /** How many buttons the card has. */
  buttons: number;
}

export type NeedKey = keyof DesignFields | "buttons";

export interface Need {
  key: NeedKey;
  /** The card has nothing for it yet. */
  missing: boolean;
}

export interface StyleNeeds {
  /** The details and buttons this style draws, each marked as filled or missing. */
  shows: Need[];
  /** The details this style does not draw (the editor does not ask for them). */
  hidden: (keyof DesignFields)[];
  /** The most buttons the style draws (null for a classic card, whose button layout is chosen separately). */
  slots: number | null;
  /** The number of buttons that fills the style (never more than it can draw). */
  wanted: number;
  /** A page style brings its own button layout. */
  ownLayout: boolean;
}

/** The most buttons a page style draws, or null for a classic card (the layout under it decides) and for a company's own face. */
export function slotsOf(d: Pick<Design, "top" | "custom_face">): number | null {
  if (d.custom_face || d.top < 1 || d.top > TOP_COUNT) return null;
  return TOP_SLOTS[d.top - 1] ?? null;
}

const ORDER = ["title", "company", "address", "bio", "photo", "cover"] as const;
/** A style looks filled with this many buttons (or fewer when it draws fewer). */
const FULL = 3;

export function styleNeeds(d: Pick<Design, "face" | "top" | "custom_face">, have: CardHas): StyleNeeds {
  const f = fieldsOf(d);
  const shows: Need[] = ORDER.filter((k) => f[k]).map((key) => ({ key, missing: !(key === "photo" ? have.photo : key === "cover" ? have.cover : have[key].trim()) }));
  const slots = slotsOf(d);
  const wanted = Math.min(slots ?? FULL, FULL);
  shows.push({ key: "buttons", missing: have.buttons < wanted });
  return { shows, hidden: unusedFields(f), slots, wanted, ownLayout: d.top >= 1 && d.top <= TOP_COUNT };
}
