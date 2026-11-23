import { I18nBoundary } from "@/lib/i18n/Boundary";

// Public card pages: the card's own language (when it sets one) is applied again inside the page.
export default function CardLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "card", "cardx"]}>{children}</I18nBoundary>;
}
