"use client";

// An empty list with one clear action and, when there is a guide for it, a "Learn more" link to the help centre.
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import s from "./guide.module.css";

export function EmptyState({ title, children, action, helpSlug }: { title: string; children?: React.ReactNode; action?: React.ReactNode; helpSlug?: string }) {
  const { t } = useI18n();
  return (
    <div className={s.empty}>
      <b>{title}</b>
      {children && <span>{children}</span>}
      {action}
      {helpSlug && <Link className={s.more} href={`/app/help/${helpSlug}`} style={{ color: "var(--blue)", fontWeight: 600 }}>{t("guide.empty.learn")}</Link>}
    </div>
  );
}
