import { I18nBoundary } from "@/lib/i18n/Boundary";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <I18nBoundary areas={["common", "err", "apiError", "auth", "security"]}>{children}</I18nBoundary>;
}
