"use client";

// Cover image upload: one block used by the design finish step and by the guided Details step.
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/app/ui";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import type { EditorApi } from "../types";

const MAX_COVER = 3 * 1024 * 1024;

export function CoverUpload({ ed }: { ed: EditorApi }) {
  const { card } = ed;
  const { t, number } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const mb = number(MAX_COVER / (1024 * 1024));

  async function onCover(f: File | undefined) {
    if (!f) return;
    if (!isAllowedImage(f)) return toast(t("common.useImage"));
    if (f.size > MAX_COVER) return toast(t("editor.pictureTooLarge", { mb }));
    setBusy(true);
    try {
      const r = await api.uploadCover(card.id, f);
      ed.setCover(r.cover_url);
      toast(t("editor.coverUpdated"));
    } catch (e) {
      toast(apiErrorText(e, t, "editor.coverFailed"));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="pane" style={{ gap: 8 }}>
      <div className="sechead"><Icon name="camera" size="s" />{t("editor.coverHead")}</div>
      <div className="photo">
        <div className="av" style={{ borderRadius: 8, width: 90, height: 56, background: "var(--surface-2)", color: "var(--mute)" }} aria-hidden="true">
          {card.cover_url ? <img src={card.cover_url} alt="" /> : <Icon name="camera" />}
        </div>
        <div>
          <input ref={file} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => void onCover(e.target.files?.[0])} />
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => file.current?.click()}><Icon name="upload" size="s" />{busy ? t("editor.uploading") : t("editor.coverUpload")}</button>
          <div className="hint" style={{ marginBlockStart: 6 }}>{t("editor.coverHint", { mb })}</div>
        </div>
      </div>
    </div>
  );
}
