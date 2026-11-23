import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewPage } from "@/components/designs/PreviewPage";
import { fetchPublicPreview } from "@/lib/designs/api";
import { I18nBoundary } from "@/lib/i18n/Boundary";
import { getI18n } from "@/lib/i18n/server";

// A private link: not indexed, not cached, readable without signing in.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("designs.previewBanner"), robots: { index: false, follow: false } };
}

export default async function CustomPreview({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await fetchPublicPreview(token);
  if (!data) notFound();
  return (
    <I18nBoundary areas={["common", "err", "card", "dash", "designs"]}>
      <PreviewPage data={data} />
    </I18nBoundary>
  );
}
