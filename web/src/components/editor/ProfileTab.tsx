"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BioField } from "./BioField";
import { ExchangePanel } from "./ExchangePanel";
import { Icon } from "@/components/Icon";
import { ContactBody } from "@/components/card/SaveSheet";
import { ToggleRow } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { GuardedField } from "@/components/ops/GuardedField";
import s from "@/components/ops/ops.module.css";
import { FREE_ACCESS, fieldHint, pendingFor } from "@/lib/ops/fields";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "@/lib/hooks";
import { addressHost } from "@/lib/card-address";
import { initials } from "@/lib/card/design";
import { isValidSlug, normaliseSlug } from "@/lib/card/slug";
import { buildVcard, previewFromCard, type VcSource } from "@/lib/card/vcard";
import { useDebounced } from "@/lib/icons-client";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import { CARD_LANGUAGES, LOCALE_NAMES, normaliseCardLanguage, type CardLanguage } from "@/lib/i18n/config";
import type { VcardOptions } from "@/lib/types";
import type { EditorApi } from "./types";
import { CoverUpload } from "./design/CoverUpload";
import { FIELD_LABELS } from "./guided";
import { unusedFields, type DesignFields } from "@/lib/library/fieldsUsed";

const MAX_PHOTO = 8 * 1024 * 1024;

/** `rest` shows only the settings that are not the card's details (address, language, visibility, contact file). `guided` is set by the step-by-step editor: it asks only for the details that design draws and leaves the other settings to the full editor. */
export function ProfileTab({ ed, guided, rest }: { ed: EditorApi; guided?: DesignFields; rest?: boolean }) {
  const { card, draft, update } = ed;
  const { t, number } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [hide, setHide] = useState(card.hide_from_directory ?? false);
  const [seo, setSeo] = useState(card.seo_indexable ?? false);
  const access = ed.access ?? FREE_ACCESS;
  const vcLocked = access.vcard !== "free";
  const photoPending = !!pendingFor(ed.pending, "photo");
  const photoHint = fieldHint("photo", access.photo, photoPending, t);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    if (!isAllowedImage(file)) return toast(t("common.useImage"));
    if (file.size > MAX_PHOTO) return toast(t("editor.photoTooLarge", { mb: number(MAX_PHOTO / (1024 * 1024)) }));
    setBusy(true);
    try {
      const r = await api.uploadPhoto(card.id, file);
      if (r.pending) {
        toast(t("editor.photoSent"));
        void qc.invalidateQueries({ queryKey: keys.card(card.id) });
      } else {
        if (r.photo_url) ed.setPhoto(r.photo_url);
        toast(t("editor.photoUpdated"));
      }
    } catch (e) {
      toast(apiErrorText(e, t, "editor.photoFailed"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const setVc = (k: keyof VcardOptions, v: boolean | string) => update({ vc: { ...draft.vc, [k]: v } });
  const src: VcSource = {
    name: draft.name, title: draft.title, company: draft.company, address: draft.address,
    items: draft.items, vc: draft.vc, cardUrl: card.public_url,
  };

  return (
    <div className="pane">
      {rest ? null : <>
      {(!guided || guided.photo) && <div className="photo">
        <div className="av" aria-hidden="true">{card.photo_url ? <img src={card.photo_url} alt="" /> : initials(draft.name)}</div>
        <div>
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden id="photo-file" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          <button type="button" className="btn ghost sm" disabled={busy || access.photo === "locked" || photoPending} onClick={() => fileRef.current?.click()}>
            <Icon name={access.photo === "locked" ? "lock" : "camera"} size="s" />{busy ? t("editor.uploading") : access.photo === "approval" ? t("editor.photoRequest") : t("editor.photoUpload")}
          </button>
          {photoHint ? <div className={`${s.fieldHint} ${photoPending ? s.wait : s.lock}`} style={{ marginBlockStart: 6 }} role="status">{photoHint}</div> : <div className="hint" style={{ marginBlockStart: 6 }}>{t("editor.photoSpec", { px: number(400) })}</div>}
        </div>
      </div>}

      <div className="row">
        <Link className="btn ghost sm" href={`/app/contacts/scan?card=${card.id}`}><Icon name="scan" size="s" />{t("editor.scanFill")}</Link>
        <span className="hint">{t("editor.scanHint")}</span>
      </div>

      <div className="two">
        <GuardedField ed={ed} field="name" label={t("editor.fullName")} autoComplete="name" />
        {(!guided || guided.title) && <GuardedField ed={ed} field="title" label={t("editor.jobTitle")} />}
      </div>
      {(!guided || guided.company) && <GuardedField ed={ed} field="company" label={t("editor.company")} />}
      {(!guided || guided.address) && <GuardedField ed={ed} field="address" label={t("editor.address")} multiline />}
      {(!guided || guided.bio) && <BioField ed={ed} />}
      {guided && guided.cover && ed.canCover && <CoverUpload ed={ed} />}
      {guided && unusedFields(guided).length > 0 && (
        <div className="hint" role="status">{t("editor.notDrawn", { list: unusedFields(guided).map((k) => t(FIELD_LABELS[k])).join(", ") })}</div>
      )}
      </>}

      {guided ? null : <>
      <SlugField ed={ed} />

      <label>
        {t("editor.cardLanguage")}
        <select value={draft.language ?? "auto"} aria-describedby="card-language-hint" onChange={(e) => update({ language: normaliseCardLanguage(e.target.value) })}>
          {CARD_LANGUAGES.map((l) => <option key={l} value={l}>{languageName(l, t("common.langAuto"))}</option>)}
        </select>
        <span id="card-language-hint" className="hint">{t("editor.cardLanguageHint")}</span>
      </label>

      {ed.brand && (
        <ToggleRow
          first
          title={t("editor.hideTitle")}
          hint={t("editor.hideHint")}
          checked={hide}
          onChange={(v) => { setHide(v); ed.patchNow({ hide_from_directory: v }); }}
        />
      )}

      <ToggleRow
        first={!ed.brand}
        title={t("growth.seoTitle")}
        hint={t("growth.seoHint")}
        checked={seo}
        onChange={(v) => { setSeo(v); ed.patchNow({ seo_indexable: v }); }}
      />

      <ExchangePanel ed={ed} />

      {vcLocked && <div className={`${s.fieldHint} ${s.lock}`} role="status">{t("editor.settingLocked")}</div>}
      <ToggleRow first title={t("editor.showSaveTitle")} hint={t("editor.showSaveHint")} checked={draft.save_contact} disabled={vcLocked} onChange={(on) => update({ save_contact: on })} />

      {draft.save_contact && (
        <div className="pane">
          <div className="sechead"><Icon name="adduser" size="s" />{t("editor.vcHead")}</div>
          <div>
            <ToggleRow first title={t("editor.vcCompany")} checked={draft.vc.company} disabled={vcLocked} onChange={(v) => setVc("company", v)} />
            <ToggleRow title={t("editor.vcPhoto")} checked={draft.vc.photo} disabled={vcLocked} onChange={(v) => setVc("photo", v)} />
            <ToggleRow title={t("editor.vcPhones")} hint={t("editor.vcPhonesHint")} checked={draft.vc.phones} disabled={vcLocked} onChange={(v) => setVc("phones", v)} />
            <ToggleRow title={t("common.email")} checked={draft.vc.emails} disabled={vcLocked} onChange={(v) => setVc("emails", v)} />
            <ToggleRow title={t("editor.vcUrls")} hint={t("editor.vcUrlsHint")} checked={draft.vc.urls} disabled={vcLocked} onChange={(v) => setVc("urls", v)} />
            <ToggleRow title={t("editor.vcSocial")} hint={t("editor.vcSocialHint")} checked={draft.vc.social} disabled={vcLocked} onChange={(v) => setVc("social", v)} />
            <ToggleRow title={t("editor.address")} checked={draft.vc.addr} disabled={vcLocked} onChange={(v) => setVc("addr", v)} />
          </div>
          <label>
            {t("editor.vcNote")}
            <input dir="auto" value={draft.vc.note} disabled={vcLocked} maxLength={140} placeholder={t("editor.vcNotePlaceholder")} onChange={(e) => setVc("note", e.target.value)} />
          </label>
          <div className="sechead">{t("editor.phonePreview")}</div>
          <div className="cpvbox"><ContactBody c={previewFromCard(src)} photoUrl={card.photo_url} /></div>
          <div className="hint">{t("editor.phonePreviewHint")}</div>
          <details className="vcf">
            <summary>{t("editor.showContactFile")}</summary>
            <pre className="ltr">{buildVcard(src)}</pre>
          </details>
        </div>
      )}
      </>}
    </div>
  );
}

/** The name of a card language in itself; "auto" follows the visitor. */
function languageName(l: CardLanguage, auto: string): string {
  return l === "auto" ? auto : LOCALE_NAMES[l];
}

/** The card's web address with a live "is it free?" check. */
function SlugField({ ed }: { ed: EditorApi }) {
  const { card, patchNow } = ed;
  const locked = (ed.access ?? FREE_ACCESS).slug !== "free";
  const { t } = useI18n();
  const [text, setText] = useState(card.slug ?? "");
  const slug = normaliseSlug(text);
  const debounced = useDebounced(slug, 450);
  const [state, setState] = useState<{ kind: "idle" | "checking" | "ok" | "taken" | "short"; suggestion?: string | null }>({ kind: "idle" });
  const saved = useRef(card.slug ?? "");

  useEffect(() => {
    if (debounced === (saved.current || "")) {
      setState({ kind: "idle" });
      return;
    }
    if (debounced === "") {
      // Clearing the address goes back to the permanent code.
      saved.current = "";
      patchNow({ slug: null });
      setState({ kind: "idle" });
      return;
    }
    if (!isValidSlug(debounced)) {
      setState({ kind: "short" });
      return;
    }
    let live = true;
    setState({ kind: "checking" });
    api.checkSlug(debounced)
      .then((r) => {
        if (!live) return;
        if (r.available) {
          setState({ kind: "ok" });
          saved.current = debounced;
          patchNow({ slug: debounced });
        } else setState({ kind: "taken", suggestion: r.suggestion });
      })
      .catch(() => live && setState({ kind: "idle" }));
    return () => {
      live = false;
    };
    // patchNow is stable for the editor's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="pane" style={{ gap: 6 }}>
      <label>
        {t("editor.slugLabel")}
        <input className="ltr" value={text} disabled={locked} onChange={(e) => setText(e.target.value)} placeholder={card.public_code} aria-describedby="slug-hint" aria-invalid={state.kind === "taken" || state.kind === "short"} />
      </label>
      <div id="slug-hint" className="hint" role="status">
        <span className="ltr" style={{ display: "inline-block" }}>{addressHost(card)}/{slug || card.public_code}</span>
        {state.kind === "checking" && <> &middot; {t("editor.slugChecking")}</>}
        {state.kind === "ok" && <b className="up"> &middot; {t("editor.slugOk")}</b>}
        {state.kind === "taken" && (
          <span className="err">
            {" "}&middot; {t("editor.slugTaken")}{" "}
            {state.suggestion && <button type="button" className="linkbtn" onClick={() => setText(state.suggestion ?? "")}>{t("editor.slugUse", { name: state.suggestion })}</button>}
          </span>
        )}
        {state.kind === "short" && <span className="err"> &middot; {t("editor.slugShort")}</span>}
      </div>
      {locked ? <div className="hint" role="status">{t("editor.settingLocked")}</div> : <div className="hint">{t("editor.slugOldLinks")}</div>}
    </div>
  );
}
