import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// Talks to the backend directly (not through the website) to prepare test data quickly.
// The backend must run with DEBUG=true and CARDS_DEV_ACTIVATE=true so a "payment" activates a plan at once.

export const API_URL = (process.env.E2E_API_URL ?? "http://localhost:8100/api/v1").replace(/\/$/, "");
export const WEB_URL = (process.env.E2E_WEB_URL ?? "http://localhost:3100").replace(/\/$/, "");
export const PASSWORD = "e2e-Passw0rd-xyz";
export const ARTIFACTS = path.resolve(__dirname, "..", "artifacts");
const CREATED_FILE = path.join(ARTIFACTS, "created-users.jsonl");

export type Json = Record<string, unknown>;

export interface TestUser {
  email: string;
  password: string;
  name: string;
  access: string;
  refresh: string;
  /** The personal workspace. */
  ws: string;
}

export class ApiFailure extends Error {
  constructor(public status: number, public body: unknown, what: string) {
    super(`${what} failed with ${status}: ${JSON.stringify(body)}`);
  }
}

let counter = 0;
/** A unique address per call, so tests never collide with each other or with an earlier run. */
export function uniqueEmail(tag = "user"): string {
  counter += 1;
  const stamp = `${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`;
  return `e2e-${tag}-${stamp}@example.com`;
}

export function uniqueSlug(tag = "card"): string {
  counter += 1;
  return `e2e-${tag}-${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 5)}`.toLowerCase();
}

export async function api<T = Json>(
  method: string,
  route: string,
  opts: { token?: string; body?: unknown; form?: FormData; headers?: Record<string, string>; expect?: number[] } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API_URL}/${route.replace(/^\//, "")}`, { method, headers, body });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const ok = opts.expect ? opts.expect.includes(res.status) : res.status >= 200 && res.status < 300;
  if (!ok) throw new ApiFailure(res.status, data, `${method} ${route}`);
  return { status: res.status, data: data as T };
}

export function remember(email: string) {
  try {
    mkdirSync(ARTIFACTS, { recursive: true });
    appendFileSync(CREATED_FILE, JSON.stringify({ email, password: PASSWORD, at: new Date().toISOString() }) + "\n");
  } catch {
    /* the clean-up list is a convenience */
  }
}

/** Registers a new account straight through the API. */
export async function registerUser(opts: { email?: string; name?: string; tag?: string; welcome?: boolean } = {}): Promise<TestUser> {
  const email = opts.email ?? uniqueEmail(opts.tag);
  const name = opts.name ?? "E2E Tester";
  const { data } = await api<{ access: string; refresh: string }>("POST", "auth/register", {
    body: { email, password: PASSWORD, full_name: name },
  });
  remember(email);
  const { data: list } = await api<{ id: string; kind: string }[]>("GET", "me/workspaces", { token: data.access });
  const personal = list.find((w) => w.kind === "personal");
  if (!personal) throw new Error("the new account has no personal workspace");
  const user = { email, password: PASSWORD, name, access: data.access, refresh: data.refresh, ws: personal.id };
  if (opts.welcome !== true) await dismissWelcome(user);
  return user;
}

/** Starts a plan through the development activation path (no card payment). */
export async function activatePlan(user: TestUser, planCode: "personal" | "company", ws = user.ws, seats?: number) {
  const { data } = await api<{ checkout_url: string }>("POST", `workspaces/${ws}/checkout`, {
    token: user.access,
    body: { plan_code: planCode, ...(seats ? { seats } : {}) },
  });
  if (!/paid=1/.test(data.checkout_url)) {
    throw new Error(`The plan did not activate at once (${data.checkout_url}). Start the backend with DEBUG=true and CARDS_DEV_ACTIVATE=true.`);
  }
}

/** Marks the welcome dialog and the product tour as seen, so they do not cover the page under test. */
export async function dismissWelcome(user: TestUser) {
  await api("PUT", "guide/progress", {
    token: user.access,
    body: { items: [{ guide_id: "welcome", step_id: "seen", state: "dismissed" }, { guide_id: "tour", step_id: "seen", state: "dismissed" }] },
    expect: [200, 400],
  });
}

/** A user with a live personal plan. */
export async function registerSubscribed(opts: { email?: string; name?: string; tag?: string; welcome?: boolean } = {}): Promise<TestUser> {
  const user = await registerUser(opts);
  await activatePlan(user, "personal");
  return user;
}

export interface CardJson {
  id: string;
  public_code: string;
  slug: string;
  status: string;
  name: string;
}

export async function createCard(user: TestUser, ws: string, fields: Json = {}): Promise<CardJson> {
  const body = {
    name: "Layla Hassan",
    title: "Head of Design",
    company: "Hassan Studio",
    slug: uniqueSlug(),
    items: [
      { kind: "Mobile", value: "+974 5555 1111", label: "Mobile" },
      { kind: "Email", value: user.email },
    ],
    ...fields,
  };
  const { data } = await api<CardJson>("POST", `workspaces/${ws}/cards`, { token: user.access, body });
  return data;
}

export async function publishCard(user: TestUser, cardId: string) {
  await api("POST", `cards/${cardId}/publish`, { token: user.access });
}

/** A subscribed user with one published card. */
export async function publishedCardFor(opts: { fields?: Json } = {}) {
  const user = await registerSubscribed();
  const card = await createCard(user, user.ws, opts.fields);
  await publishCard(user, card.id);
  return { user, card };
}

/** A company workspace on the company plan, owned by a fresh user. */
export async function companyFor(opts: { name?: string; seats?: number } = {}) {
  const owner = await registerUser({ name: "Olivia Owner", tag: "owner" });
  const { data } = await api<{ id: string }>("POST", "workspaces", { token: owner.access, body: { name: opts.name ?? "Acme E2E Ltd" } });
  await activatePlan(owner, "company", data.id, opts.seats ?? 10);
  return { owner, ws: data.id };
}

export async function inviteMember(owner: TestUser, ws: string, email: string, extra: Json = {}) {
  const { data } = await api<{ id: string; card_id: string; email: string }[]>("POST", `workspaces/${ws}/invites`, {
    token: owner.access,
    body: { invites: [{ email, ...extra }] },
  });
  return data[0];
}

/** A visitor's contact request on a public card, with the form-open time the anti-bot check expects. */
export async function createLead(publicCode: string, fields: Json = {}) {
  return api("POST", `public/cards/${publicCode}/leads`, {
    body: { name: "Visitor Vic", email: "vic@example.com", consent: true, website_url: "", opened_at: Date.now() - 10_000, ...fields },
  });
}
