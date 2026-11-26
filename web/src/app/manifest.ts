import type { MetadataRoute } from "next";
import { APP_FULL_NAME, APP_NAME } from "@/lib/config";
import { dirOf } from "@/lib/i18n/config";
import { getI18n, getRequestLanguage } from "@/lib/i18n/server";

// The web app manifest: what the browser needs to offer "Install" and to draw the app's icon, name and colours.
// The shortcut names follow the visitor's language, like every other page.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { t } = await getI18n();
  const { locale } = await getRequestLanguage();
  const icon = (src: string, sizes: string, purpose: "any" | "maskable") => ({ src, sizes, type: "image/png", purpose });
  return {
    id: "/app",
    name: `${APP_NAME} - ${APP_FULL_NAME}`,
    short_name: APP_NAME,
    description: `${t("common.tagline")} ${t("common.metaDescription")}`,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#101114",
    lang: locale,
    dir: dirOf(locale),
    categories: ["business", "productivity"],
    icons: [
      icon("/brand/icon-192.png", "192x192", "any"),
      icon("/brand/icon-512.png", "512x512", "any"),
      icon("/brand/icon-maskable-512.png", "512x512", "maskable"),
    ],
    shortcuts: [
      { name: t("growth.pwaShortcutQr"), url: "/app/share", icons: [{ src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: t("growth.pwaShortcutCards"), url: "/app/cards", icons: [{ src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: t("growth.pwaShortcutScan"), url: "/app/contacts/scan", icons: [{ src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
