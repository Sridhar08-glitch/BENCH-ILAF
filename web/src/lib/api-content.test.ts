import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { contentApi, defaultSectionData, isMp4, movedGallery, uploadWithProgress, VIDEO_MAX_BYTES } from "./api-content";

const ok = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("content API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists, creates, changes, reorders and removes sections through the proxy", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === "DELETE") return ok(null, 204);
      return ok([{ id: "s1", kind: "map", order: 0, on: true, data: {} }]);
    }));
    await contentApi.sections("c1");
    await contentApi.createSection("c1", "map", defaultSectionData("map", "UTC"));
    await contentApi.updateSection("c1", "s1", { on: false });
    await contentApi.reorderSections("c1", ["s2", "s1"]);
    await contentApi.deleteSection("c1", "s1");
    expect(calls.map((c) => `${c.init.method ?? "GET"} ${c.url}`)).toEqual([
      "GET /api/proxy/cards/c1/sections",
      "POST /api/proxy/cards/c1/sections",
      "PATCH /api/proxy/cards/c1/sections/s1",
      "POST /api/proxy/cards/c1/sections/reorder",
      "DELETE /api/proxy/cards/c1/sections/s1",
    ]);
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ kind: "map", data: { title: "", address: "", maps_url: "", directions_note: "" } });
    expect(JSON.parse(calls[3].init.body as string)).toEqual({ ids: ["s2", "s1"] });
    expect(calls[0].init.credentials).toBe("same-origin");
  });

  it("turns a refused write into an ApiError with the upgrade code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "plan_limit", message: "Upgrade." } }), { status: 403 })));
    await expect(contentApi.createSection("c1", "video", { title: "" })).rejects.toMatchObject({ code: "plan_limit", status: 403 });
  });

  it("sends gallery pictures as multipart and patches captions and order", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({ id: "g1", url: "u", caption: "", order: 0 });
    }));
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    await contentApi.uploadGalleryImage("c1", file, "Brand");
    await contentApi.updateGalleryImage("c1", "g1", { caption: "x", order: 2 });
    expect(calls[0].url).toBe("/api/proxy/cards/c1/gallery");
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    expect((calls[0].init.body as FormData).get("caption")).toBe("Brand");
    expect(calls[1].url).toBe("/api/proxy/cards/c1/gallery/g1");
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ caption: "x", order: 2 });
  });

  it("falls back to fetch for an upload where XMLHttpRequest is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ video_url: "v", video_poster_url: null })));
    const seen: number[] = [];
    const r = await uploadWithProgress<{ video_url: string }>("cards/c1/video", new FormData(), (f) => seen.push(f));
    expect(r.video_url).toBe("v");
  });

  it("reports progress and maps errors when XMLHttpRequest is there", async () => {
    class FakeXhr {
      static last: FakeXhr;
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 0;
      responseText = "";
      withCredentials = false;
      responseType = "";
      method = "";
      url = "";
      open(method: string, url: string) { this.method = method; this.url = url; FakeXhr.last = this; }
      getResponseHeader() { return null; }
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const seen: number[] = [];
    const p = uploadWithProgress<{ video_url: string }>("cards/c1/video", new FormData(), (f) => seen.push(f));
    FakeXhr.last.status = 200;
    FakeXhr.last.responseText = JSON.stringify({ video_url: "v" });
    await expect(p).resolves.toEqual({ video_url: "v" });
    expect(seen).toEqual([0.5, 1]);
    expect(FakeXhr.last.url).toBe("/api/proxy/cards/c1/video");
    expect(FakeXhr.last.withCredentials).toBe(true);

    const p2 = uploadWithProgress("cards/c1/video", new FormData());
    FakeXhr.last.status = 413;
    FakeXhr.last.responseText = JSON.stringify({ error: { code: "file_too_large", message: "Too big." } });
    await expect(p2).rejects.toBeInstanceOf(ApiError);
    await expect(p2).rejects.toMatchObject({ code: "file_too_large", status: 413 });
  });
});

describe("content helpers", () => {
  it("accepts MP4 files by type, else by name", () => {
    expect(isMp4({ type: "video/mp4", name: "x" })).toBe(true);
    expect(isMp4({ type: "video/quicktime", name: "x.mp4" })).toBe(false);
    expect(isMp4({ type: "", name: "clip.MP4" })).toBe(true);
    expect(isMp4({ type: "", name: "clip.mov" })).toBe(false);
    expect(VIDEO_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  it("starts each kind with sensible empty data", () => {
    const hours = defaultSectionData("hours", "Asia/Qatar");
    expect(hours.timezone).toBe("Asia/Qatar");
    expect(hours.days).toHaveLength(7);
    expect(hours.days[5].closed).toBe(true);
    expect(defaultSectionData("products", "UTC")).toEqual({ title: "", layout: "grid" });
    expect(defaultSectionData("team", "UTC")).toEqual({ title: "", cards: [] });
    expect(defaultSectionData("event", "UTC").ends_at).toBeNull();
  });

  it("moves a gallery picture one step and reports the rows whose order changed", () => {
    const list = [
      { id: "a", url: "", caption: "", order: 0 },
      { id: "b", url: "", caption: "", order: 1 },
      { id: "c", url: "", caption: "", order: 2 },
    ];
    const r = movedGallery(list, "c", -1);
    expect(r.list.map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(r.changed.map((i) => `${i.id}:${i.order}`)).toEqual(["c:1", "b:2"]);
    expect(movedGallery(list, "a", -1).changed).toEqual([]);
    expect(movedGallery(list, "zzz", 1).changed).toEqual([]);
  });
});
