"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/app/ui";
import { VIDEO_ACCEPT, VIDEO_MAX_BYTES, contentApi, isMp4, type CardVideo } from "@/lib/api-content";
import { keys } from "@/lib/hooks";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import type { Card } from "@/lib/types";
import { SectionTitle } from "./SectionTitle";
import type { SectionFormProps } from "./types";
import c from "./content.module.css";

const MAX_POSTER = 8 * 1024 * 1024;

export function VideoForm({ ed, section, onChange, disabled, onError }: SectionFormProps<"video"> & { onError?: (e: unknown) => void }) {
  const { t, number } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const card = ed.card as Card & Partial<CardVideo>;
  const [video, setVideo] = useState<CardVideo>({ video_url: card.video_url ?? null, video_poster_url: card.video_poster_url ?? null });
  const [progress, setProgress] = useState<number | null>(null);
  const [posterBusy, setPosterBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const mb = number(VIDEO_MAX_BYTES / (1024 * 1024));

  /** Keep the card in the query cache in step, so the preview and a reopened editor know the video. */
  const remember = (next: Partial<CardVideo>) => {
    setVideo((v) => ({ ...v, ...next }));
    qc.setQueryData<Card>(keys.card(card.id), (old) => (old ? { ...old, ...next } : old));
  };

  async function onVideo(file: File | undefined) {
    if (!file) return;
    if (!isMp4(file)) return toast(t("content.videoNotMp4"));
    if (file.size > VIDEO_MAX_BYTES) return toast(t("content.videoTooLarge", { mb }));
    setProgress(0);
    try {
      const r = await contentApi.uploadVideo(card.id, file, (f) => setProgress(f));
      remember({ video_url: r.video_url, ...(r.video_poster_url !== undefined ? { video_poster_url: r.video_poster_url } : {}) });
      toast(t("content.videoUploaded"));
    } catch (e) {
      onError?.(e);
      toast(apiErrorText(e, t, "content.videoFailed"));
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeVideo() {
    if (!window.confirm(t("content.videoDeleteConfirm"))) return;
    try {
      await contentApi.deleteVideo(card.id);
      remember({ video_url: null, video_poster_url: null });
      toast(t("content.videoDeleted"));
    } catch (e) {
      toast(apiErrorText(e, t, "content.videoFailed"));
    }
  }

  async function onPoster(file: File | undefined) {
    if (!file) return;
    if (!isAllowedImage(file)) return toast(t("common.useImage"));
    if (file.size > MAX_POSTER) return toast(t("editor.pictureTooLarge", { mb: number(MAX_POSTER / (1024 * 1024)) }));
    setPosterBusy(true);
    try {
      const r = await contentApi.uploadVideoPoster(card.id, file);
      remember({ video_poster_url: r.video_poster_url });
      toast(t("content.posterUploaded"));
    } catch (e) {
      onError?.(e);
      toast(apiErrorText(e, t, "content.videoFailed"));
    } finally {
      setPosterBusy(false);
      if (posterRef.current) posterRef.current.value = "";
    }
  }

  async function removePoster() {
    try {
      await contentApi.deleteVideoPoster(card.id);
      remember({ video_poster_url: null });
    } catch (e) {
      toast(apiErrorText(e, t, "content.videoFailed"));
    }
  }

  const uploading = progress !== null;
  return (
    <>
      <SectionTitle value={section.data.title} disabled={disabled} onChange={(title) => onChange({ ...section.data, title })} placeholder={t("content.defVideo")} />
      {video.video_url ? (
        <div className={c.video}><video controls playsInline preload="metadata" src={video.video_url} poster={video.video_poster_url ?? undefined} /></div>
      ) : (
        <p className="hint">{t("content.videoNone")}</p>
      )}
      {uploading && (
        <div className="pane" style={{ gap: 6 }}>
          <div className={c.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <span className={c.status}>{t("content.videoUploading", { pct: number(Math.round(progress * 100)) })}</span>
        </div>
      )}
      <div className="row">
        <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => void onVideo(e.target.files?.[0])} />
        <button type="button" className="btn ghost sm" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size="s" />{video.video_url ? t("content.videoReplace") : t("content.videoUpload")}
        </button>
        {video.video_url && (
          <button type="button" className="btn danger sm" disabled={disabled || uploading} onClick={() => void removeVideo()}>
            <Icon name="trash" size="s" />{t("content.videoDelete")}
          </button>
        )}
        <span className="hint">{t("content.videoSpec", { mb })}</span>
      </div>
      {video.video_url && (
        <div className="row">
          <input ref={posterRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => void onPoster(e.target.files?.[0])} />
          <button type="button" className="btn ghost sm" disabled={disabled || posterBusy} onClick={() => posterRef.current?.click()}>
            <Icon name="camera" size="s" />{posterBusy ? t("editor.uploading") : t("content.posterUpload")}
          </button>
          {video.video_poster_url && (
            <button type="button" className="btn ghost sm" disabled={disabled || posterBusy} onClick={() => void removePoster()}>{t("content.posterDelete")}</button>
          )}
          <span className="hint">{t("content.posterHint")}</span>
        </div>
      )}
    </>
  );
}
