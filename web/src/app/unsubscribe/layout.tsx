import { I18nBoundary } from "@/lib/i18n/Boundary";

// The unsubscribe page of product-update e-mails: no sign-in needed.
export default function UnsubscribeLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "apiError", "auth", "bo"]}>{children}</I18nBoundary>;
}
