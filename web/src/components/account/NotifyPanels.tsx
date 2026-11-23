"use client";

// Settings > Notifications: browser notifications (opt-in, hidden until the server has VAPID keys) and the daily summary e-mail.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/app/Switch";
import crm from "@/components/crm/crm.module.css";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { browserTimeZone, currentSubscription, disablePush, enablePush, pushState, pushSupported, type PushState } from "@/lib/push-client";
import { notifyApi, type NotifyPrefs } from "@/lib/security-api";

const KEY = ["notify-prefs"] as const;

function useNotifyPrefs() {
  return useQuery({ queryKey: KEY, queryFn: notifyApi.prefs });
}

export function PushPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const prefs = useNotifyPrefs();
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  const p = prefs.data;

  useEffect(() => {
    let live = true;
    const supported = pushSupported();
    if (!supported) return setState("unsupported");
    currentSubscription()
      .then((sub) => live && setState(pushState(true, Notification.permission, !!sub)))
      .catch(() => live && setState("off"));
    return () => {
      live = false;
    };
  }, []);

  const save = useMutation({
    mutationFn: (b: Partial<Pick<NotifyPrefs, "push_leads" | "push_support">>) => notifyApi.update(b),
    onSuccess: (d) => {
      qc.setQueryData(KEY, d);
      toast(t("common.saved"));
    },
    onError: (e) => toast(apiErrorText(e, t, "settings.saveFailed")),
  });

  // Without server keys the whole panel stays out of the way.
  if (!p || !p.push_available || !p.vapid_public_key) return null;
  const key = p.vapid_public_key;

  async function turnOn() {
    setBusy(true);
    try {
      const sub = await enablePush(key);
      if (!sub) {
        setState(pushState(true, Notification.permission, false));
        return;
      }
      await notifyApi.subscribe(sub.toJSON());
      await qc.invalidateQueries({ queryKey: KEY });
      setState("on");
      toast(t("security.pushOnToast"));
    } catch (e) {
      toast(apiErrorText(e, t, "security.pushFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const endpoint = await disablePush();
      if (endpoint) await notifyApi.unsubscribe(endpoint);
      await qc.invalidateQueries({ queryKey: KEY });
      setState("off");
    } catch (e) {
      toast(apiErrorText(e, t, "security.pushFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel card">
      <div className="head"><h2><span className="chip"><Icon name="bell" size="s" /></span>{t("security.pushTitle")}</h2></div>
      <div className="hint">{t("security.pushHint")}</div>
      {state === "unsupported" && <div className="hint" role="status">{t("security.pushUnsupported")}</div>}
      {state === "denied" && <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t("security.pushDenied")}</div></div>}
      {(state === "off" || state === "on") && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {state === "off" ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void turnOn()}>{t("security.pushEnable")}</button>
          ) : (
            <>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void turnOff()}>{t("security.pushDisable")}</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void notifyApi.test().then(() => toast(t("security.pushTestSent"))).catch((e) => toast(apiErrorText(e, t, "security.pushFailed")))}>{t("security.pushTest")}</button>
            </>
          )}
        </div>
      )}
      {state === "on" && (
        <div>
          <div className={crm.switchRow}>
            <div><b>{t("security.pushLeads")}</b><span className="hint">{t("security.pushLeadsHint")}</span></div>
            <Switch label={t("security.pushLeads")} checked={p.push_leads} disabled={save.isPending} onChange={(v) => save.mutate({ push_leads: v })} />
          </div>
          <div className={crm.switchRow}>
            <div><b>{t("security.pushSupport")}</b><span className="hint">{t("security.pushSupportHint")}</span></div>
            <Switch label={t("security.pushSupport")} checked={p.push_support} disabled={save.isPending} onChange={(v) => save.mutate({ push_support: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

export function DailySummaryPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const prefs = useNotifyPrefs();
  const save = useMutation({
    mutationFn: (on: boolean) => notifyApi.update({ daily_summary: on, ...(on ? { timezone: browserTimeZone() } : {}) }),
    onSuccess: (d) => {
      qc.setQueryData(KEY, d);
      toast(t("common.saved"));
    },
    onError: (e) => toast(apiErrorText(e, t, "settings.saveFailed")),
  });
  const p = prefs.data;
  return (
    <div className="panel card">
      <div className="head"><h2><span className="chip"><Icon name="mail" size="s" /></span>{t("security.dailyTitle")}</h2></div>
      {prefs.isLoading ? <SkeletonBlocks rows={2} /> : prefs.error ? <ErrorBox error={prefs.error} onRetry={() => void prefs.refetch()} /> : p && (
        <div>
          <div className={crm.switchRow}>
            <div><b>{t("security.dailyLabel")}</b><span className="hint">{t("security.dailyHint", { zone: p.timezone })}</span></div>
            <Switch label={t("security.dailyLabel")} checked={p.daily_summary} disabled={save.isPending} onChange={(v) => save.mutate(v)} />
          </div>
          <p className="hint">{t("security.dailyUnsubscribe")}</p>
        </div>
      )}
    </div>
  );
}
