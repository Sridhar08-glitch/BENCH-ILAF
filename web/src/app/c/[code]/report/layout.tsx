import { I18nBoundary } from "@/lib/i18n/Boundary";

// The report form: the visitor's language, no card chrome.
export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "apiError", "bo"]}>{children}</I18nBoundary>;
}
