"use client";

// Announcement banners from the product team, in the person's language. Each one can be dismissed (and stays dismissed).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { call } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export interface Announcement { id: string; severity: "info" | "warning" | "critical"; title: string; body: string }

/** The CSS class of a banner: the notice style that matches its severity. */
export function bannerClass(severity: Announcement["severity"]): string {
  return severity === "critical" ? "notice bad" : severity === "warning" ? "notice warn" : "notice";
}

export function Announcements() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["announcements"], queryFn: () => call<{ results: Announcement[] }>("announcements"),
    staleTime: 60_000, refetchInterval: 300_000, retry: false, refetchOnWindowFocus: false,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => call<void>(`announcements/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["announcements"] }),
  });
  const rows = list.data?.results ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-label={t("bo.annRegion")} style={{ display: "grid", gap: 8 }}>
      {rows.map((a) => (
        <div key={a.id} className={bannerClass(a.severity)} role={a.severity === "critical" ? "alert" : "status"}>
          <Icon name="alert" />
          <div className="grow"><b>{a.title}</b>{a.body}</div>
          <button type="button" className="btn ghost sm" aria-label={t("bo.annDismiss")} onClick={() => dismiss.mutate(a.id)}><Icon name="x" size="s" /></button>
        </div>
      ))}
    </section>
  );
}
