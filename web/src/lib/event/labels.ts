// The words of the event notes spreadsheet, shared by the event page's export and the sign-out warning's export.
import { tk, type MessageKey } from "@/lib/i18n";
import type { EventTag } from "./notes";

export const TAG_NAMES: Record<EventTag, MessageKey> = {
  "": tk("growth.eventTagNone"), hot: tk("growth.eventTagHot"), warm: tk("growth.eventTagWarm"), follow_up: tk("growth.eventTagFollow"),
};

export const CSV_HEADER: MessageKey[] = [
  tk("growth.eventCsvTime"), tk("growth.eventCsvEvent"), tk("growth.eventCsvName"), tk("growth.eventCsvCompany"), tk("growth.eventCsvEmail"),
  tk("growth.eventCsvPhone"), tk("growth.eventCsvTag"), tk("growth.eventCsvNote"), tk("growth.eventCsvSent"),
];
