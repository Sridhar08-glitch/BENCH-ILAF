import type { Metadata } from "next";
import { Providers } from "@/components/app/Providers";
import { WorkspaceProvider } from "@/components/app/WorkspaceContext";
import { Shell } from "@/components/app/Shell";
import { AREAS } from "@/lib/i18n/messages";
import { I18nBoundary } from "@/lib/i18n/Boundary";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("shell.dashboardTitle"), robots: { index: false, follow: false } };
}

// The signed-in app ships every area except the sign-in pages' own texts.
const APP_AREAS = AREAS.filter((a) => a !== "auth");

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nBoundary areas={APP_AREAS}>
      <Providers>
        <WorkspaceProvider>
          <Shell>{children}</Shell>
        </WorkspaceProvider>
      </Providers>
    </I18nBoundary>
  );
}
