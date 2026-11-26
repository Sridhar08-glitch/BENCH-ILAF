// The owner's calls for the rich content under a card: sections, the uploaded video and the gallery pictures.
// Everything goes through this app's /api/proxy like the main client (lib/api.ts), with the same ApiError.
import { ApiError, errorFromResponse, waitingError } from "./api";
import { runtimeT } from "./i18n";
import type { EventSectionData, GalleryImage, HoursSectionData, MapSectionData, ProductsLayout, SectionKind } from "./public-api";

/** How a section's `data` looks in the editor (the public page receives team cards and gallery pictures expanded instead). */
export type EditorSectionData = {
  video: { title: string };
  products: { title: string; layout: ProductsLayout };
  hours: HoursSectionData;
  booking: { title: string };
  /** The public codes of up to twelve published cards of the same workspace. */
  team: { title: string; cards: string[] };
  gallery: { title: string };
  event: EventSectionData;
  map: MapSectionData;
};

export type CardSection = { [K in SectionKind]: { id: string; kind: K; order: number; on: boolean; data: EditorSectionData[K]; created_at?: string; updated_at?: string } }[SectionKind];
export type SectionOf<K extends SectionKind> = Extract<CardSection, { kind: K }>;

/** The video fields the owner's card JSON carries. */
export interface CardVideo {
  video_url: string | null;
  video_poster_url: string | null;
}

/** The largest video file the API accepts. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_ACCEPT = "video/mp4";

/** True for an MP4 file (the API checks the bytes themselves too). */
export function isMp4(file: { type: string; name: string }): boolean {
  if (file.type) return /^video\/mp4$/i.test(file.type);
  return /\.(mp4|m4v)$/i.test(file.name);
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function call<T>(method: Method, path: string, body?: unknown, form?: FormData): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  if (method !== "GET") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path}`, init);
  } catch {
    throw new ApiError(0, "network_error", runtimeT("err.offline"));
  }
  if (!res.ok) {
    let json: Parameters<typeof errorFromResponse>[1] = null;
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* not JSON */
    }
    throw errorFromResponse(res, json);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A multipart upload that reports its progress (0..1). Falls back to a plain fetch where XMLHttpRequest is missing. */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  const waiting = waitingError();
  if (waiting) return Promise.reject(waiting);
  if (typeof XMLHttpRequest === "undefined") return call<T>("POST", path, undefined, form);
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/proxy/${path}`);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onerror = () => reject(new ApiError(0, "network_error", runtimeT("err.offline")));
    xhr.onabort = () => reject(new ApiError(0, "network_error", runtimeT("err.offline")));
    xhr.onload = () => {
      let json: Record<string, unknown> | null = null;
      try {
        json = xhr.responseText ? (JSON.parse(xhr.responseText) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve((json ?? {}) as T);
        return;
      }
      const headers = { get: (name: string) => xhr.getResponseHeader(name) };
      reject(errorFromResponse({ status: xhr.status, headers }, json as Parameters<typeof errorFromResponse>[1]));
    };
    xhr.send(form);
  });
}

const S = (card: string) => `cards/${card}/sections`;

export const contentApi = {
  // sections
  sections: (card: string) => call<CardSection[]>("GET", S(card)),
  createSection: <K extends SectionKind>(card: string, kind: K, data: EditorSectionData[K]) => call<SectionOf<K>>("POST", S(card), { kind, data }),
  updateSection: <K extends SectionKind>(card: string, id: string, patch: { on?: boolean; data?: EditorSectionData[K] }) => call<SectionOf<K>>("PATCH", `${S(card)}/${id}`, patch),
  deleteSection: (card: string, id: string) => call<void>("DELETE", `${S(card)}/${id}`),
  reorderSections: (card: string, ids: string[]) => call<CardSection[] | void>("POST", `${S(card)}/reorder`, { ids }),

  // video (one per card; a video section only places it)
  uploadVideo: (card: string, file: File, onProgress?: (fraction: number) => void) => {
    const f = new FormData();
    f.append("file", file);
    return uploadWithProgress<CardVideo>(`cards/${card}/video`, f, onProgress);
  },
  deleteVideo: (card: string) => call<void>("DELETE", `cards/${card}/video`),
  uploadVideoPoster: (card: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return call<Pick<CardVideo, "video_poster_url">>("POST", `cards/${card}/video-poster`, undefined, f);
  },
  deleteVideoPoster: (card: string) => call<void>("DELETE", `cards/${card}/video-poster`),

  // gallery (up to nine pictures per card)
  gallery: (card: string) => call<GalleryImage[]>("GET", `cards/${card}/gallery`),
  uploadGalleryImage: (card: string, file: File, caption = "") => {
    const f = new FormData();
    f.append("file", file);
    if (caption) f.append("caption", caption);
    return call<GalleryImage>("POST", `cards/${card}/gallery`, undefined, f);
  },
  updateGalleryImage: (card: string, id: string, patch: { caption?: string; order?: number }) => call<GalleryImage>("PATCH", `cards/${card}/gallery/${id}`, patch),
  deleteGalleryImage: (card: string, id: string) => call<void>("DELETE", `cards/${card}/gallery/${id}`),
};

/** The query keys of the content screens. */
export const contentKeys = {
  sections: (card: string) => ["sections", card] as const,
  gallery: (card: string) => ["gallery", card] as const,
};

/** Empty data for a new section of a kind. */
export function defaultSectionData<K extends SectionKind>(kind: K, timezone: string): EditorSectionData[K] {
  const all: EditorSectionData = {
    video: { title: "" },
    products: { title: "", layout: "grid" },
    hours: { title: "", timezone, days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, open: "09:00", close: "18:00", closed: d >= 5 })), note: "" },
    booking: { title: "" },
    team: { title: "", cards: [] },
    gallery: { title: "" },
    event: { title: "", event_name: "", starts_at: "", ends_at: null, venue: "", hall: "", stand: "", talk_title: "", talk_time: "", slides_url: "" },
    map: { title: "", address: "", maps_url: "", directions_note: "" },
  };
  return all[kind];
}

/** The gallery pictures in their saved order after one is moved; returns the rows whose order changed. */
export function movedGallery(images: readonly GalleryImage[], id: string, dir: -1 | 1): { list: GalleryImage[]; changed: GalleryImage[] } {
  const list = images.slice().sort((a, b) => a.order - b.order);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return { list, changed: [] };
  [list[i], list[j]] = [list[j], list[i]];
  const changed: GalleryImage[] = [];
  const out = list.map((img, idx) => {
    if (img.order === idx) return img;
    const next = { ...img, order: idx };
    changed.push(next);
    return next;
  });
  return { list: out, changed };
}
