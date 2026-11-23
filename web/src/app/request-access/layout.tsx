import { I18nBoundary } from "@/lib/i18n/Boundary";

// The public "Talk to us" page: open to signed-out visitors, in the visitor's language.
export default function RequestAccessLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "apiError", "auth", "bo"]}>{children}</I18nBoundary>;
}
