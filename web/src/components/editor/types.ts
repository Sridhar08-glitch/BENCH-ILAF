import type { Card, Design, FieldAccess, PendingChange, VcardOptions } from "@/lib/types";
import type { Btn } from "@/lib/card/buttons";
import type { ResolvedIcon } from "@/lib/card/brand";
import type { CompanyBrand } from "@/lib/library/types";
import type { CardLanguage } from "@/lib/i18n";

/** The parts of a card the editor changes. */
export interface Draft {
  name: string;
  title: string;
  company: string;
  address: string;
  save_contact: boolean;
  /** The language of the public page: a fixed one, or "auto" for the visitor's own. Missing means "auto". */
  language?: CardLanguage;
  vc: VcardOptions;
  design: Design;
  items: Btn[];
}

export interface EditorApi {
  card: Card;
  draft: Draft;
  /** Change any draft field(s); items are sent to the API in full. */
  update: (patch: Partial<Draft>) => void;
  /** Save a field that is not part of the draft (the address). */
  patchNow: (patch: Record<string, unknown>) => void;
  /** Design fields are locked by the company. */
  locked: boolean;
  /** Logos of the items, same order as draft.items. */
  icons: ResolvedIcon[];
  /** Remember a new photo address. */
  setPhoto: (url: string) => void;
  /** Remember a new cover picture address. */
  setCover: (url: string) => void;
  /** The card can have its own cover picture (false on the company brand page). */
  canCover: boolean;
  /** The company the card belongs to (company colours, logo, artwork), or null for a personal card. */
  brand?: CompanyBrand | null;
  /** Play the opening animation again on the preview. */
  replay: () => void;
  /** What the signed-in person may change (company rules). Missing means everything. */
  access?: FieldAccess;
  /** Changes of this card that wait for an admin. */
  pending?: PendingChange[];
  /** Ask an admin to approve a new value for a field that needs approval. Returns a sentence when it failed, else null. */
  requestChange?: (field: "name" | "title" | "company" | "address", value: string) => Promise<string | null>;
  /** Take a waiting request back. */
  withdraw?: (id: string) => Promise<void>;
  /** Button changes are held until the person sends them for approval. */
  itemsHeld?: boolean;
  sendItems?: () => Promise<void>;
  discardItems?: () => void;
  /** A problem with the buttons as they are now (a banned link or a kind the company does not allow). */
  itemsIssue?: string | null;
}
