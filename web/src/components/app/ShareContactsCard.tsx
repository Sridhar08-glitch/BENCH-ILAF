"use client";

// The employee's switch "Share my new contacts with {company}" (Settings). Off until the employee turns it on.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { hasShareSwitch } from "@/lib/sharing/contacts";

export const MEMBERSHIP_KEY = (ws: string) => ["my-membership", ws] as const;

/** The membership of the signed-in person in this company (their own switch). Only asked for employees. */
export function useMyMembership() {
  const { current, role, isCompany } = useWs();
  return useQuery({ queryKey: MEMBERSHIP_KEY(current.id), queryFn: () => api.myMembership(current.id), enabled: hasShareSwitch(role, isCompany), staleTime: 60_000 });
}

export function ShareContactsCard() {
  const { current, role, isCompany } = useWs();
  const { t, date } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMyMembership();
  const set = useMutation({
    mutationFn: (on: boolean) => api.setShareContacts(current.id, on),
    onSuccess: (m) => {
      qc.setQueryData(MEMBERSHIP_KEY(current.id), m);
      toast(t(m.share_contacts ? "settings.shareSavedOn" : "settings.shareSavedOff"));
    },
    onError: (e) => toast(apiErrorText(e, t, "settings.shareFailed")),
  });
  if (!hasShareSwitch(role, isCompany) || !me.data?.can_share_contacts) return null;
  const on = me.data.share_contacts;
  const company = current.name;
  const changed = me.data.share_contacts_changed_at ? ` ${t("settings.shareChanged", { date: date(me.data.share_contacts_changed_at, { day: "numeric", month: "short", year: "numeric" }) })}` : "";
  return (
    <section className="panel card" aria-labelledby="share-h" data-guide="share-contacts">
      <div className="head"><h2 id="share-h"><span className="chip"><Icon name="users" size="s" /></span><bdi>{t("settings.shareTitle", { company })}</bdi></h2></div>
      <p className="hint">{t("settings.shareIntro", { company })}</p>
      <p className="hint">{t("settings.shareOnText", { company })}</p>
      <p className="hint">{t("settings.shareKept")}</p>
      <div className="toggle first">
        <div>
          {t(on ? "settings.shareStateOn" : "settings.shareStateOff")}
          <small>{t("settings.shareDefault")}{changed}</small>
        </div>
        <Switch checked={on} onChange={(v) => set.mutate(v)} label={t("settings.shareSwitch")} disabled={set.isPending} />
      </div>
    </section>
  );
}
