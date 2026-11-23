import { I18nBoundary } from "@/lib/i18n/Boundary";

// The privacy policy and terms are public pages; they use the visitor's language like every other page.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "legal"]}>{children}</I18nBoundary>;
}
