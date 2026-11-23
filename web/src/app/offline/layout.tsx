import type { Metadata } from "next";
import { I18nBoundary } from "@/lib/i18n/Boundary";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("growth.offlineTitle"), robots: { index: false, follow: false } };
}

// The page the app shows when there is no connection (kept by the service worker); it uses the visitor's language.
export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "growth"]}>{children}</I18nBoundary>;
}
