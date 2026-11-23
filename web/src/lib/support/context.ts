// The facts a support request carries about the page it was sent from. Only what helps to find a problem, never a secret:
// no cookies, tokens, form values or query strings. The server adds the browser, the role and the plan by itself.
import type { SupportContext } from "./types";

// Anything that looks like a token, a key or a password is left out.
const SECRET_LIKE = /(eyJ[A-Za-z0-9_-]{10,}\.|bearer\s|[A-Za-z0-9_-]{32,}|password|passwd|secret|token)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path of an address without its query string and fragment (they can carry tokens). Empty when it is not a plain path. */
export function pathOnly(value: string | null | undefined): string {
  if (!value) return "";
  let path = value;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return "";
  }
  path = path.split("?")[0].split("#")[0];
  if (!path.startsWith("/") || path.length > 200) return "";
  // a path segment that is a uuid is an id of a card or company: fine; a long opaque segment is probably a token
  const cleaned = path.split("/").filter((s) => !UUID.test(s)).join("/");
  return SECRET_LIKE.test(cleaned) ? "" : path;
}

function safeText(value: unknown, limit = 40): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).slice(0, limit);
  if (UUID.test(text)) return text;
  return SECRET_LIKE.test(text) ? "" : text;
}

export interface ContextInput {
  pathname?: string;
  language?: string;
  buildId?: string;
  workspaceId?: string;
  cardId?: string;
  screen?: { w: number; h: number };
}

/** The context to attach, built from values the page already knows. */
export function buildContext(input: ContextInput): SupportContext {
  const out: SupportContext = {};
  const route = pathOnly(input.pathname);
  if (route) {
    out.page_url = route;
    out.route = route;
  }
  const language = safeText(input.language, 5);
  if (language) out.app_language = language;
  const build = safeText(input.buildId);
  if (build) out.build_id = build;
  const workspace = safeText(input.workspaceId);
  if (workspace) out.workspace_id = workspace;
  const card = safeText(input.cardId);
  if (card) out.card_id = card;
  const s = input.screen;
  if (s && Number.isFinite(s.w) && Number.isFinite(s.h) && s.w > 0 && s.h > 0 && s.w < 20000 && s.h < 20000) out.screen = { w: Math.round(s.w), h: Math.round(s.h) };
  return out;
}

/** The context of the browser right now (only call this in the browser). */
export function captureContext(extra: Pick<ContextInput, "language" | "workspaceId" | "cardId" | "pathname"> = {}): SupportContext {
  return buildContext({
    pathname: extra.pathname ?? window.location.pathname,
    language: extra.language,
    buildId: process.env.NEXT_PUBLIC_BUILD_ID,
    workspaceId: extra.workspaceId,
    cardId: extra.cardId,
    screen: { w: window.innerWidth, h: window.innerHeight },
  });
}

/** The lines the form shows so the person sees exactly what is sent (label key, value). */
export type ContextKey = "page" | "language" | "build" | "screen" | "workspace" | "card" | "browser" | "role" | "plan";
export function contextLines(ctx: SupportContext): { key: ContextKey; value: string }[] {
  const lines: { key: ContextKey; value: string }[] = [];
  if (ctx.page_url) lines.push({ key: "page", value: ctx.page_url });
  if (ctx.app_language) lines.push({ key: "language", value: ctx.app_language });
  if (ctx.build_id) lines.push({ key: "build", value: ctx.build_id });
  if (ctx.screen) lines.push({ key: "screen", value: `${ctx.screen.w} x ${ctx.screen.h}` });
  if (ctx.workspace_id) lines.push({ key: "workspace", value: ctx.workspace_id });
  if (ctx.card_id) lines.push({ key: "card", value: ctx.card_id });
  if (ctx.browser || ctx.os) lines.push({ key: "browser", value: [ctx.browser, ctx.os].filter(Boolean).join(", ") });
  if (ctx.role) lines.push({ key: "role", value: ctx.role });
  if (ctx.plan_label) lines.push({ key: "plan", value: ctx.plan_label });
  return lines;
}
