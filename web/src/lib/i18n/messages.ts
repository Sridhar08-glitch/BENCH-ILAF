// The English source texts and the catalogue of every language. English is the source: a key exists when it is
// in the English files, and every other language must have exactly the same keys (checked by the compiler and by
// i18n.test.ts). Add a text in en/<area>.ts first, then in ar/<area>.ts.
import type { Locale } from "./config";
import { common as en_common } from "./en/common";
import { err as en_err } from "./en/err";
import { apiError as en_apiError } from "./en/apiError";
import { auth as en_auth } from "./en/auth";
import { shell as en_shell } from "./en/shell";
import { card as en_card } from "./en/card";
import { editor as en_editor } from "./en/editor";
import { cards as en_cards } from "./en/cards";
import { team as en_team } from "./en/team";
import { contacts as en_contacts } from "./en/contacts";
import { analytics as en_analytics } from "./en/analytics";
import { brand as en_brand } from "./en/brand";
import { company as en_company } from "./en/company";
import { tools as en_tools } from "./en/tools";
import { settings as en_settings } from "./en/settings";
import { billing as en_billing } from "./en/billing";
import { dash as en_dash } from "./en/dash";
import { legal as en_legal } from "./en/legal";
import { dev as en_dev } from "./en/dev";
import { guide as en_guide } from "./en/guide";
import { help as en_help } from "./en/help";
import { growth as en_growth } from "./en/growth";
import { designs as en_designs } from "./en/designs";
import { staff as en_staff } from "./en/staff";
import { support as en_support } from "./en/support";
import { bo as en_bo } from "./en/bo";
import { security as en_security } from "./en/security";
import { cardx as en_cardx } from "./en/cardx";
import { common as ar_common } from "./ar/common";
import { err as ar_err } from "./ar/err";
import { apiError as ar_apiError } from "./ar/apiError";
import { auth as ar_auth } from "./ar/auth";
import { shell as ar_shell } from "./ar/shell";
import { card as ar_card } from "./ar/card";
import { editor as ar_editor } from "./ar/editor";
import { cards as ar_cards } from "./ar/cards";
import { team as ar_team } from "./ar/team";
import { contacts as ar_contacts } from "./ar/contacts";
import { analytics as ar_analytics } from "./ar/analytics";
import { brand as ar_brand } from "./ar/brand";
import { company as ar_company } from "./ar/company";
import { tools as ar_tools } from "./ar/tools";
import { settings as ar_settings } from "./ar/settings";
import { billing as ar_billing } from "./ar/billing";
import { dash as ar_dash } from "./ar/dash";
import { legal as ar_legal } from "./ar/legal";
import { dev as ar_dev } from "./ar/dev";
import { guide as ar_guide } from "./ar/guide";
import { help as ar_help } from "./ar/help";
import { growth as ar_growth } from "./ar/growth";
import { designs as ar_designs } from "./ar/designs";
import { staff as ar_staff } from "./ar/staff";

import { support as ar_support } from "./ar/support";
import { bo as ar_bo } from "./ar/bo";
import { security as ar_security } from "./ar/security";
import { cardx as ar_cardx } from "./ar/cardx";

/** The shape of a language file: the same keys as the English file, every value a string. */
export type Messages<T> = { [K in keyof T]: string };

/** The areas, in the order the files are merged. A key starts with its area name and a dot. */
export const AREAS = ["common", "err", "apiError", "auth", "shell", "card", "editor", "cards", "team", "contacts", "analytics", "brand", "company", "tools", "settings", "billing", "dash", "legal", "guide", "help", "dev", "designs", "staff", "growth", "support", "bo", "security", "cardx"] as const;
export type Area = (typeof AREAS)[number];

export const en = {
  ...en_common,
  ...en_err,
  ...en_apiError,
  ...en_auth,
  ...en_shell,
  ...en_card,
  ...en_editor,
  ...en_cards,
  ...en_team,
  ...en_contacts,
  ...en_analytics,
  ...en_brand,
  ...en_company,
  ...en_tools,
  ...en_settings,
  ...en_billing,
  ...en_dash,
  ...en_legal,
  ...en_dev,
  ...en_guide,
  ...en_help,
  ...en_growth,
  ...en_designs,
  ...en_staff,
  ...en_support,
  ...en_bo,
  ...en_security,
  ...en_cardx,
};

export type MessageKey = Extract<keyof typeof en, string>;
export type Catalogue = Record<MessageKey, string>;

const ar: Catalogue = {
  ...ar_common,
  ...ar_err,
  ...ar_apiError,
  ...ar_auth,
  ...ar_shell,
  ...ar_card,
  ...ar_editor,
  ...ar_cards,
  ...ar_team,
  ...ar_contacts,
  ...ar_analytics,
  ...ar_brand,
  ...ar_company,
  ...ar_tools,
  ...ar_settings,
  ...ar_billing,
  ...ar_dash,
  ...ar_legal,
  ...ar_dev,
  ...ar_guide,
  ...ar_help,
  ...ar_growth,
  ...ar_designs,
  ...ar_staff,
  ...ar_support,
  ...ar_bo,
  ...ar_security,
  ...ar_cardx,
};

/** Every language. A language added here must be listed in config.ts too. */
export const CATALOGUES: Record<Locale, Catalogue> = { en, ar };
