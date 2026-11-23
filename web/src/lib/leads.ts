// Names for where a contact came from.
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";
import type { Lead } from "@/lib/types";

const SOURCES: Record<string, MessageKey> = {
  nfc: tk("contacts.srcNfc"), qr: tk("contacts.srcQr"), link: tk("contacts.srcLink"), email: tk("contacts.srcEmail"),
  exchange: tk("contacts.sourceExchange"), meeting_request: tk("contacts.sourceMeeting"), scanned_card: tk("contacts.sourceScanned"), event: tk("contacts.sourceEvent"),
};
const CHANNELS: Record<string, MessageKey> = { nfc: tk("contacts.chNfc"), qr: tk("contacts.chQr"), link: tk("contacts.chLink"), email: tk("contacts.chEmail") };

/** How a contact arrived, for example "Shared details (QR scan)". */
export function reachedBy(l: Pick<Lead, "source" | "channel">, t: TFunction): string {
  const base = SOURCES[l.source] ? t(SOURCES[l.source]) : l.source;
  const via = l.channel && CHANNELS[l.channel] ? t(CHANNELS[l.channel]) : "";
  return via ? t("contacts.reachedVia", { source: base, via }) : base;
}
