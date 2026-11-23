import { I18nBoundary } from "@/lib/i18n/Boundary";

// The public contact page: open to signed-out visitors, in the visitor's language.
export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "apiError", "auth", "support"]}>{children}</I18nBoundary>;
}
