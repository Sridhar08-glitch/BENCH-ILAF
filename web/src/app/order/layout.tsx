import type { Metadata } from "next";
import { I18nBoundary } from "@/lib/i18n/Boundary";

// The page a buyer opens from the order e-mail or the thank-you screen: no sign-in, never listed by search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "apiError", "card", "commerce"]}>{children}</I18nBoundary>;
}
