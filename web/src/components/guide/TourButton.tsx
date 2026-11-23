"use client";

// The "Show me how" button of a page. It only asks the guide to start the tour of the page it is on.
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { TOUR_EVENT } from "@/lib/guide/api";
import s from "./guide.module.css";

export function TourButton() {
  const { t } = useI18n();
  return (
    <button type="button" className={`btn ghost ${s.tourbtn}`} onClick={() => window.dispatchEvent(new CustomEvent(TOUR_EVENT))}>
      <Icon name="eye" size="s" />{t("guide.tour.show")}
    </button>
  );
}
