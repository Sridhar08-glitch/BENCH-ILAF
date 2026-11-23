// Which message holds the default text of each kind of button. Brand buttons (Instagram, WhatsApp, ...) keep
// their brand name in every language, so they are not listed.
import { tk, type MessageKey } from "@/lib/i18n";

/** The default text of a button whose owner did not write a label. */
export const KIND_LABELS: Record<string, MessageKey> = {
  Mobile: tk("card.btnMobile"), Landline: tk("card.btnLandline"), Email: tk("card.btnEmail"), SMS: tk("card.btnSms"),
  Location: tk("card.btnLocation"), Website: tk("card.btnWebsite"), Calendly: tk("card.btnBook"), PayPal: tk("card.btnPay"),
  Custom: tk("card.btnLink"), Meeting: tk("card.btnBook"),
  Document: tk("cardx.btnDocument"), DownloadFile: tk("cardx.btnDownload"), Menu: tk("cardx.btnMenu"), GoogleReview: tk("cardx.btnReview"),
  WhatsAppChannel: tk("cardx.btnChannel"), Shopify: tk("cardx.btnShop"),
};

/** The short name under an icon. */
export const KIND_SHORT: Record<string, MessageKey> = {
  Mobile: tk("card.nameMobile"), Landline: tk("card.nameLandline"), Email: tk("card.nameEmail"), SMS: tk("card.nameSms"),
  Location: tk("card.shortDirections"), Website: tk("card.nameWebsite"), Calendly: tk("card.shortMeet"),
};
