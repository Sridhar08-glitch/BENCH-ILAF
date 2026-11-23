import { I18nBoundary } from "@/lib/i18n/Boundary";

export default function DirectoryLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "card", "cardx", "company"]}>{children}</I18nBoundary>;
}
