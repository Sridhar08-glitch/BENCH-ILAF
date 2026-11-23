// The guide engine: pure functions that turn guides (data), the context (facts) and the person's saved marks
// into what the checklist shows. No React, no network.
import { tk } from "@/lib/i18n";
import { GUIDES } from "./guides";
import { ALL_DONE, FOLLOW_UPS, SUGGESTIONS, type Suggestion } from "./whatnext";
import type {
  Audience, Condition, Guide, GuideContext, GuideView, ProgressItem, ProgressState, Step, StepView,
} from "./types";
import { AUDIENCES } from "./types";

/** Ids of the saved rows that are not guide steps. */
export const WELCOME = "welcome";
export const FLAG = "flag";
export const NEXT = "next";
export const HELP = "help";
export const TOUR = "tour";
export const CHECKLIST = "checklist";

export function evaluate(cond: Condition, ctx: GuideContext): boolean {
  if ("is" in cond) return Boolean(ctx[cond.is]);
  if ("gte" in cond) {
    const v = ctx[cond.gte[0]];
    return typeof v === "number" && v >= cond.gte[1];
  }
  if ("all" in cond) return cond.all.every((c) => evaluate(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, ctx));
  return !evaluate(cond.not, ctx);
}

/** The step's page, with "{card}" filled in; a missing card falls back to the cards list. */
export function resolveRoute(route: string, ctx: Pick<GuideContext, "card_id">): string {
  if (!route.includes("{card}")) return route;
  return ctx.card_id ? route.replace("{card}", encodeURIComponent(ctx.card_id)) : route.replace("/{card}", "");
}

/** The deep link of a step: its page with ?guide=<step id>, which the page uses to highlight the right spot. */
export function stepHref(step: Step, ctx: Pick<GuideContext, "card_id">): string {
  const route = resolveRoute(step.route, ctx);
  return `${route}${route.includes("?") ? "&" : "?"}guide=${encodeURIComponent(step.id)}`;
}

// ---- saved marks

export function stateOf(progress: ProgressItem[], guideId: string, stepId: string): ProgressState | null {
  return progress.find((p) => p.guide_id === guideId && p.step_id === stepId)?.state ?? null;
}

/** Merge a change into the list: a newer row for the same guide and step replaces the old one, "reset" removes it. */
export function mergeProgress(list: ProgressItem[], change: { guide_id: string; step_id: string; state: ProgressState | "reset" }, now = new Date().toISOString()): ProgressItem[] {
  const rest = list.filter((p) => !(p.guide_id === change.guide_id && p.step_id === change.step_id));
  if (change.state === "reset") return rest;
  return [...rest, { guide_id: change.guide_id, step_id: change.step_id, state: change.state, updated: now }];
}

/** Server rows plus changes made here that the server has not confirmed yet (the later one wins per key). */
export function mergeServerAndLocal(server: ProgressItem[], local: ProgressItem[]): ProgressItem[] {
  let out = server;
  for (const row of local) {
    const have = out.find((p) => p.guide_id === row.guide_id && p.step_id === row.step_id);
    if (!have || (row.updated ?? "") >= (have.updated ?? "")) out = mergeProgress(out, row, row.updated);
  }
  return out;
}

/** The client flags (things only the browser saw, such as "opened the QR page"), read from the saved rows. */
export function flagsOf(progress: ProgressItem[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of progress) if (p.guide_id === FLAG && p.state === "done") out[p.step_id] = true;
  return out;
}

// ---- audience

export interface AudienceFacts {
  kind: "personal" | "company";
  role: "owner" | "admin" | "employee";
}

/** The audience that is obvious from the role, or null when the person must be asked. */
export function inferAudience(f: AudienceFacts): Audience | null {
  if (f.kind === "company") {
    if (f.role === "employee") return "employee";
    return f.role === "owner" ? "company_owner" : "company_admin";
  }
  return null;
}

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

/** What the person said they want to do, from the welcome screens (saved as welcome/audience-<value> = done). */
export function chosenAudience(progress: ProgressItem[]): Audience | null {
  for (const a of AUDIENCES) if (stateOf(progress, WELCOME, `audience-${a}`) === "done") return a;
  return null;
}

/** The audience to guide: the one that is obvious from the role, else their choice, else personal. */
export function audienceFor(facts: AudienceFacts, progress: ProgressItem[]): Audience {
  const inferred = inferAudience(facts);
  if (inferred) return inferred;
  const chosen = chosenAudience(progress);
  // A person who chose "set up my company" while still in their personal workspace keeps the company path.
  return chosen && chosen !== "employee" ? chosen : "personal";
}

/** True until the person has finished or skipped the welcome screens. */
export function needsWelcome(facts: AudienceFacts, progress: ProgressItem[]): boolean {
  return stateOf(progress, WELCOME, "seen") === null;
}

/** True when the question "what do you want to do?" is worth asking (not when the role says it all). */
export function needsQuestion(facts: AudienceFacts): boolean {
  return inferAudience(facts) === null;
}

// ---- the checklist

function applies(step: Step, ctx: GuideContext): boolean {
  return !step.appliesWhen || evaluate(step.appliesWhen, ctx);
}

export function guideView(guide: Guide, ctx: GuideContext, progress: ProgressItem[]): GuideView {
  const steps: StepView[] = guide.steps
    .filter((s) => applies(s, ctx))
    .map((step) => {
      const mark = stateOf(progress, guide.id, step.id);
      const auto = step.doneWhen ? evaluate(step.doneWhen, ctx) : false;
      const status = auto || mark === "done" ? "done" : mark === "skipped" ? "skipped" : "todo";
      return { step, status, auto, href: stepHref(step, ctx) } satisfies StepView;
    });
  const counted = steps.filter((s) => !s.step.optional);
  const finished = counted.filter((s) => s.status !== "todo").length;
  const total = counted.length;
  const next = counted.find((s) => s.status === "todo") ?? steps.find((s) => s.status === "todo") ?? null;
  return {
    guide,
    steps,
    total,
    finished,
    percent: total === 0 ? 100 : Math.round((finished / total) * 100),
    complete: total > 0 && finished === total,
    next,
  };
}

export function viewFor(audience: Audience, ctx: GuideContext, progress: ProgressItem[]): GuideView {
  return guideView(GUIDES[audience], ctx, progress);
}

/** Ids of the steps that are done now but were not before (so "what next" can react to a change). */
export function newlyDone(before: GuideView | null, after: GuideView): string[] {
  if (!before) return [];
  const was = new Set(before.steps.filter((s) => s.status === "done").map((s) => s.step.id));
  return after.steps.filter((s) => s.status === "done" && !was.has(s.step.id)).map((s) => s.step.id);
}

// ---- what next

export interface NextUp {
  id: string;
  title: Suggestion["title"];
  text: Suggestion["text"];
  route: string;
  action: Suggestion["action"];
}

function suggestionVisible(s: Suggestion, ctx: GuideContext): boolean {
  if (s.when && !evaluate(s.when, ctx)) return false;
  if (s.doneWhen && evaluate(s.doneWhen, ctx)) return false;
  return true;
}

/**
 * One or two things to do after `stepId` was finished: the listed follow-ups that still make sense, then the next
 * unfinished step of the guide.
 */
export function whatNext(view: GuideView, stepId: string, ctx: GuideContext, max = 2): NextUp[] {
  const out: NextUp[] = [];
  for (const id of FOLLOW_UPS[stepId] ?? []) {
    const s = SUGGESTIONS[id];
    if (s && suggestionVisible(s, ctx)) out.push({ id: s.id, title: s.title, text: s.text, route: s.route, action: s.action });
  }
  const nextStep = view.steps.find((s) => s.status === "todo" && s.step.id !== stepId);
  if (nextStep) out.push({ id: nextStep.step.id, title: nextStep.step.title, text: nextStep.step.text, route: nextStep.href, action: nextStep.step.action ?? tk("guide.open") });
  return out.slice(0, max);
}

/** What to offer when everything is done. */
export function allDoneSuggestions(ctx: GuideContext, max = 4): Suggestion[] {
  return ALL_DONE.map((id) => SUGGESTIONS[id]).filter((s) => s && suggestionVisible(s, ctx)).slice(0, max);
}

/** A prompt is shown once per person: true when its event has no saved row yet. */
export function promptDue(progress: ProgressItem[], event: string): boolean {
  return stateOf(progress, NEXT, event) === null;
}
