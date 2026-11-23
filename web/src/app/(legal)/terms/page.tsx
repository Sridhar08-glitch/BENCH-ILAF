import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { APP_NAME, WEB_URL } from "@/lib/config";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  const title = t("legal.termsTitle");
  const description = t("growth.metaTerms", { app: APP_NAME });
  const url = `${WEB_URL}/terms`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: APP_NAME, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

// Drawn per request: the language, the support address and the draft banner setting come from the request and the environment.
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return <LegalPage doc="terms" />;
}
