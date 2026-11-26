"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/app/ui";
import { MAX_GALLERY } from "@/components/card/sections/helpers";
import { contentApi, contentKeys, movedGallery } from "@/lib/api-content";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import type { GalleryImage } from "@/lib/public-api";
import { SectionTitle } from "./SectionTitle";
import type { SectionFormProps } from "./types";
import c from "./content.module.css";

const MAX_PICTURE = 8 * 1024 * 1024;
const MAX_CAPTION = 80;

export function GalleryForm({ ed, section, onChange, disabled, onError }: SectionFormProps<"gallery"> & { onError?: (e: unknown) => void }) {
  const { t, number } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const cardId = ed.card.id;
  const q = useQuery({ queryKey: contentKeys.gallery(cardId), queryFn: () => contentApi.gallery(cardId) });
  const images = (q.data ?? []).slice().sort((a, b) => a.order - b.order);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const timers = useRef<Record<string, number>>({});
  const setList = (list: GalleryImage[]) => qc.setQueryData(contentKeys.gallery(cardId), list);
  const full = images.length >= MAX_GALLERY;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_GALLERY - images.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    setBusy(true);
    let list = images;
    try {
      for (const file of picked) {
        if (!isAllowedImage(file)) {
          toast(t("common.useImage"));
          continue;
        }
        if (file.size > MAX_PICTURE) {
          toast(t("editor.pictureTooLarge", { mb: number(MAX_PICTURE / (1024 * 1024)) }));
          continue;
        }
        const img = await contentApi.uploadGalleryImage(cardId, file);
        list = [...list, img];
        setList(list);
      }
      if (picked.length) toast(t("content.galleryUploaded"));
    } catch (e) {
      onError?.(e);
      toast(apiErrorText(e, t, "content.galleryFailed"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function caption(id: string, value: string) {
    setList(images.map((i) => (i.id === id ? { ...i, caption: value } : i)));
    window.clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(() => {
      contentApi.updateGalleryImage(cardId, id, { caption: value }).catch((e) => toast(apiErrorText(e, t, "content.saveFailed")));
    }, 700);
  }

  async function move(id: string, dir: -1 | 1) {
    const { list, changed } = movedGallery(images, id, dir);
    if (!changed.length) return;
    setList(list);
    try {
      await Promise.all(changed.map((i) => contentApi.updateGalleryImage(cardId, i.id, { order: i.order })));
    } catch (e) {
      toast(apiErrorText(e, t, "content.saveFailed"));
      void qc.invalidateQueries({ queryKey: contentKeys.gallery(cardId) });
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("content.galleryRemoveConfirm"))) return;
    try {
      await contentApi.deleteGalleryImage(cardId, id);
      setList(images.filter((i) => i.id !== id));
    } catch (e) {
      toast(apiErrorText(e, t, "content.saveFailed"));
    }
  }

  return (
    <>
      <SectionTitle value={section.data.title} disabled={disabled} onChange={(title) => onChange({ ...section.data, title })} placeholder={t("content.defGallery")} />
      <div className="row">
        <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        <button type="button" className="btn ghost sm" disabled={disabled || busy || full} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size="s" />{busy ? t("editor.uploading") : t("content.galleryUpload")}
        </button>
        <span className="hint">{full ? t("content.galleryFull", { n: number(MAX_GALLERY) }) : t("content.gallerySpec", { n: number(MAX_GALLERY) })}</span>
      </div>
      {q.isLoading && <div className="skeleton" style={{ height: 80 }} />}
      {!q.isLoading && images.length === 0 && <p className="hint">{t("content.galleryEmpty")}</p>}
      {images.length > 0 && (
        <div className={c.thumbs}>
          {images.map((img, i) => (
            <div key={img.id} className={c.thumb}>
              <img src={img.url} alt={img.caption || ""} />
              <input dir="auto" value={img.caption} maxLength={MAX_CAPTION} disabled={disabled} placeholder={t("content.caption")} aria-label={t("content.caption")} onChange={(e) => caption(img.id, e.target.value)} />
              <div className={c.tools}>
                <button type="button" className={c.iconbtn} disabled={disabled || i === 0} aria-label={t("content.moveUp")} onClick={() => void move(img.id, -1)}><Icon name="arrow" size="s" style={{ transform: "rotate(-45deg)" }} /></button>
                <button type="button" className={c.iconbtn} disabled={disabled || i === images.length - 1} aria-label={t("content.moveDown")} onClick={() => void move(img.id, 1)}><Icon name="down" size="s" /></button>
                <button type="button" className={c.iconbtn} disabled={disabled} aria-label={t("content.galleryRemove")} onClick={() => void remove(img.id)}><Icon name="trash" size="s" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
