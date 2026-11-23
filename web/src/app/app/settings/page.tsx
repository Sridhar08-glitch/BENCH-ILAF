"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Icon } from "@/components/Icon";
import { DigitsSwitcher, LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PageHead, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { LeadSettingsPanel } from "@/components/app/LeadSettingsPanel";
import { ProductUpdatesSwitch } from "@/components/app/ProductUpdatesSwitch";
import { ApiError, api } from "@/lib/api";
import { keys } from "@/lib/hooks";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

export default function SettingsPage() {
  const { user, isManager, isCompany } = useWs();
  const isCompanyManager = isManager && isCompany;
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [profileErr, setProfileErr] = useState("");
  const [pwErr, setPwErr] = useState("");

  // The schemas are built here so their messages come in the user's language.
  const profileSchema = useMemo(() => z.object({ full_name: z.string().trim().min(2, t("settings.nameRequired")) }), [t]);
  const pwSchema = useMemo(
    () =>
      z
        .object({ old_password: z.string().min(1, t("settings.pwOldRequired")), new_password: z.string().min(8, t("settings.pwMin")), confirm: z.string() })
        .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: t("settings.pwMismatch") }),
    [t],
  );

  const profile = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema), defaultValues: { full_name: user.full_name } });
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });

  return (
    <div className="view">
      <PageHead title={t("settings.title")} sub={t("settings.sub")} />
      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <form
          className="panel card"
          noValidate
          onSubmit={profile.handleSubmit(async (v) => {
            setProfileErr("");
            try {
              await api.updateMe({ full_name: v.full_name });
              void qc.invalidateQueries({ queryKey: keys.me });
              toast(t("settings.profileSaved"));
            } catch (e) {
              setProfileErr(apiErrorText(e, t, "settings.saveFailed"));
            }
          })}
        >
          <div className="head"><h2><span className="chip"><Icon name="user" size="s" /></span>{t("settings.profile")}</h2></div>
          <label>{t("settings.fullName")}<input dir="auto" autoComplete="name" aria-invalid={!!profile.formState.errors.full_name} {...profile.register("full_name")} />
            {profile.formState.errors.full_name && <span className="err" role="alert">{profile.formState.errors.full_name.message}</span>}
          </label>
          <label>{t("common.email")}<input className="ltr" value={user.email} readOnly /></label>
          {profileErr && <span className="err" role="alert">{profileErr}</span>}
          <button type="submit" className="btn" disabled={profile.formState.isSubmitting}>{t("settings.saveProfile")}</button>
        </form>

        <section className="panel card" aria-labelledby="lang-h">
          <div className="head"><h2 id="lang-h"><span className="chip"><Icon name="globe" size="s" /></span>{t("settings.language")}</h2></div>
          <div className="pane" style={{ gap: 6 }}>
            <span className="sechead">{t("common.language")}</span>
            <LanguageSwitcher signedIn label={false} />
            <div className="hint">{t("common.languageHelp")}</div>
          </div>
          <div className="pane" style={{ gap: 6 }}>
            <span className="sechead">{t("common.digits")}</span>
            <DigitsSwitcher />
            <div className="hint">{t("common.digitsHelp")}</div>
          </div>
          <ProductUpdatesSwitch />
        </section>

        {user.has_password !== false && (
        <form
          className="panel card"
          noValidate
          onSubmit={pw.handleSubmit(async (v) => {
            setPwErr("");
            try {
              await api.changePassword(v.old_password, v.new_password);
              pw.reset();
              toast(t("settings.pwChanged"));
            } catch (e) {
              if (e instanceof ApiError && e.field("old_password")) pw.setError("old_password", { message: apiFieldText(e, "old_password", t) });
              else setPwErr(apiErrorText(e, t, "settings.pwChangeFailed"));
            }
          })}
        >
          <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("settings.changePassword")}</h2></div>
          {(["old_password", "new_password", "confirm"] as const).map((f) => (
            <label key={f}>
              {f === "old_password" ? t("settings.currentPassword") : f === "new_password" ? t("settings.newPassword") : t("settings.repeatNew")}
              <input type="password" autoComplete={f === "old_password" ? "current-password" : "new-password"} aria-invalid={!!pw.formState.errors[f]} {...pw.register(f)} />
              {pw.formState.errors[f] && <span className="err" role="alert">{pw.formState.errors[f]?.message}</span>}
            </label>
          ))}
          {pwErr && <span className="err" role="alert">{pwErr}</span>}
          <button type="submit" className="btn" disabled={pw.formState.isSubmitting}>{t("settings.changePassword")}</button>
        </form>
        )}
        <section className="panel card" aria-labelledby="acct-h">
          <div className="head"><h2 id="acct-h"><span className="chip"><Icon name="lock" size="s" /></span>{t("settings.account")}</h2></div>
          <div className="hint">{t("settings.accountHint")}</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link className="btn ghost sm" href="/app/settings/sign-in">{t("settings.signInMethods")}</Link>
            <Link className="btn ghost sm" href="/app/settings/security">{t("security.pageTitle")}</Link>
            <Link className="btn ghost sm" href="/app/settings/devices">{t("security.devicesTitle")}</Link>
            {isCompanyManager && <Link className="btn ghost sm" href="/app/settings/company">{t("security.companyTitle")}</Link>}
            <Link className="btn ghost sm" href="/app/settings/privacy">{t("settings.privacyData")}</Link>
            <a className="btn ghost sm" href="/privacy" target="_blank" rel="noopener noreferrer">{t("common.privacy")}</a>
            <a className="btn ghost sm" href="/terms" target="_blank" rel="noopener noreferrer">{t("common.terms")}</a>
          </div>
        </section>
        <section className="panel card" aria-labelledby="notif-h">
          <div className="head"><h2 id="notif-h"><span className="chip"><Icon name="mail" size="s" /></span>{t("settings.reportsIntegrations")}</h2></div>
          <div className="hint">{t("settings.reportsHint")}</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link className="btn ghost sm" href="/app/settings/notifications">{t("settings.weeklyReport")}</Link>
            <Link className="btn ghost sm" href="/app/settings/integrations">{t("settings.integrations")}</Link>
            <Link className="btn ghost sm" href="/app/settings/developers">{t("dev.title")}</Link>
          </div>
        </section>
        <LeadSettingsPanel />
      </div>
    </div>
  );
}
