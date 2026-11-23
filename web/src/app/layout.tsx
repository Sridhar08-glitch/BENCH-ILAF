import type { Metadata, Viewport } from "next";
import { Bebas_Neue, DM_Serif_Display, IBM_Plex_Sans_Arabic, JetBrains_Mono, Playfair_Display, Plus_Jakarta_Sans, Poppins, Syne } from "next/font/google";
import "./globals.css";
import { APP_FULL_NAME, APP_NAME, COMPANY_NAME, WEB_URL } from "@/lib/config";
import { dirOf } from "@/lib/i18n/config";
import { getI18n, getRequestLanguage } from "@/lib/i18n/server";

// The app's own typeface (the BENCH brand font). No metric-adjusted fallback face: it would claim Arabic letters before the Arabic font gets them.
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], variable: "--font-poppins", display: "swap", adjustFontFallback: false });
// Fonts used by the card faces (they are the customers' own card styling, not the app chrome).
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "700"], style: ["normal", "italic"], variable: "--font-playfair", display: "swap" });
const dmserif = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-dmserif", display: "swap" });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-jbmono", display: "swap" });
const syne = Syne({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-syne", display: "swap" });
// Arabic glyphs for the app and for Arabic text on cards: the Latin fonts have none, so each text run falls through to this one.
const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], variable: "--font-plex-ar", display: "swap", adjustFontFallback: false, fallback: ["Segoe UI", "Tahoma", "Arial", "sans-serif"] });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  metadataBase: new URL(WEB_URL),
  title: { default: `${APP_NAME} by ${COMPANY_NAME}`, template: `%s | ${APP_NAME}` },
  description: `${APP_FULL_NAME}. ${t("common.tagline")} ${t("common.metaDescription")}`,
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/brand/favicon.png", type: "image/png" }],
    apple: "/brand/apple-touch-icon.png",
  },
  applicationName: APP_NAME,
  // Opened from the iPhone home screen the app has its own title and no browser bars.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FFFFFF" };

// The page's language and direction come from the visitor's setting (cookie, then browser), so every page is
// drawn per request. A card page can still set its own language inside its own subtree.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getRequestLanguage();
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${poppins.variable} ${jakarta.variable} ${playfair.variable} ${dmserif.variable} ${bebas.variable} ${jbmono.variable} ${syne.variable} ${plexArabic.variable}`}>
      <body>{children}</body>
    </html>
  );
}
