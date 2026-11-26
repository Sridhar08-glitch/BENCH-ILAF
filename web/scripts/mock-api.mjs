// A small in-memory stand-in for the real API, following the API contract.
// Run it with `npm run mock-api` (port 8100) to try every screen without the backend.
// Demo sign-ins: demo@ilaf.test / demo1234 (owner) and staff@ilaf.test / demo1234 (employee).
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT || 8100);
const WEB = process.env.WEB_BASE_URL || "http://localhost:3100";
const BASE = `http://localhost:${PORT}`;
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const code = () => Array.from({ length: 10 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[crypto.randomInt(31)]).join("");

// ---- data
const db = {
  users: [], workspaces: [], members: [], cards: [], leads: [], invoices: [], invites: [], events: [], media: new Map(),
  tokens: new Map(), refresh: new Map(),
};
const PLANS = [
  { code: "free", name: "Free", kind: "personal", interval: "month", price_minor: 0, currency: "QAR", max_cards: 1, per_seat: false, min_seats: 1, features: ["1 digital card for 7 days"], purchasable: false },
  { code: "personal", name: "Personal", kind: "personal", interval: "year", price_minor: 4900, currency: "QAR", max_cards: 1, per_seat: false, min_seats: 1, features: ["NFC and QR sharing", "Contact collection", "Basic analytics"] },
  { code: "business", name: "Business", purchasable: false, kind: "personal", interval: "year", price_minor: 9900, currency: "QAR", max_cards: 5, per_seat: false, min_seats: 1, features: ["All 100 designs", "Contact export", "Full analytics"] },
  { code: "company", name: "Company", kind: "company", interval: "year", price_minor: 3900, currency: "QAR", max_cards: 1, per_seat: true, min_seats: 5, features: ["Company brand and design lock", "Team management", "Custom domain"] },
];
const DEFAULT_VC = { company: true, photo: true, phones: true, emails: true, urls: true, social: true, addr: true, note: "Saved from my BENCH card" };
// A design is numbers: face 1..400 with colourway 0..3, the layout below the card 1..400, the opening 0..400 (0 = none).
const DESIGN = (o = {}) => ({ face: 1, colour: 0, below: 1, intro: 1, font: "face", size: 100, photo: true, brand_colors: false, foot: true, ...o });
const ALLOWED = ["http:", "https:", "tel:", "mailto:", "sms:", "skype:", "tg:", "viber:", "facetime:", "facetime-audio:", "geo:"];

function seed() {
  const demo = { id: id(), email: "demo@ilaf.test", full_name: "Jasir Vadakkedath", photo_url: null, created_at: now(), password: "demo1234" };
  const staff = { id: id(), email: "staff@ilaf.test", full_name: "Sara Al Thani", photo_url: null, created_at: now(), password: "demo1234" };
  db.users.push(demo, staff);
  const personal = { id: id(), kind: "personal", name: "Personal", owner: demo.id, custom_domain: null, brand: null, sub: { status: "active", plan_code: "business", seats_total: 1, starts_at: days(-60), ends_at: days(305) } };
  const company = {
    id: id(), kind: "company", name: "Gulf Studio", owner: demo.id, custom_domain: null,
    brand: { company_name: "Gulf Studio", logo_url: null, website: "gulfstudio.example", design: DESIGN({ face: 60, colour: 0, below: 12, intro: 9 }), lock_design: false, show_footer: true },
    sub: { status: "active", plan_code: "company", seats_total: 5, starts_at: days(-30), ends_at: days(335) },
  };
  db.workspaces.push(personal, company);
  db.members.push(
    { id: id(), ws: personal.id, user: demo.id, email: demo.email, full_name: demo.full_name, role: "owner", status: "active", card_id: null, invited_at: now(), joined_at: now() },
    { id: id(), ws: company.id, user: demo.id, email: demo.email, full_name: demo.full_name, role: "owner", status: "active", card_id: null, invited_at: now(), joined_at: now() },
    { id: id(), ws: company.id, user: staff.id, email: staff.email, full_name: staff.full_name, role: "employee", status: "active", card_id: null, invited_at: now(), joined_at: now() },
    { id: id(), ws: company.id, user: null, email: "omar@gulfstudio.example", full_name: "Omar Ali", role: "employee", status: "invited", card_id: null, invited_at: now(), joined_at: null },
  );
  const mk = (ws, owner, name, title, company_, slug, design, items, status = "published") => {
    const c = {
      id: id(), workspace_id: ws.id, owner_id: owner?.id ?? null, public_code: code(), slug, status, name, title, company: company_,
      address: "Al Yasmin Building, near Amer Center, Abu Hail Metro Station, Dubai", photo_url: null, cover_url: null, save_contact: true, vc: { ...DEFAULT_VC }, design,
      items: items.map((it, i) => ({ id: id(), icon: null, label: "", on: true, ...it, order: i })), created_at: now(), updated_at: now(), slugs: slug ? [slug] : [],
    };
    db.cards.push(c);
    return c;
  };
  const items = [
    { kind: "Mobile", value: "+971 50 669 8770" }, { kind: "WhatsApp", value: "+971 50 669 8770" }, { kind: "Landline", value: "+971 4 331 9655" },
    { kind: "Email", value: "info@jascorps.com" }, { kind: "Instagram", value: "instagram.com/jascorps" }, { kind: "Website", value: "jascorps.com" },
    { kind: "LinkedIn", value: "linkedin.com/company/jascorps" }, { kind: "Location", value: "Deira, Dubai" },
  ];
  mk(personal, demo, "Jasir Vadakkedath", "Managing Director", "Jas Documents Clearing Services", "jasir", DESIGN({ face: 1, colour: 0, below: 1, intro: 1 }), items);
  mk(personal, demo, "Jas Documents Office", "Customer service", "Jas Documents Clearing Services", "jas-office", DESIGN({ face: 44, colour: 2, below: 7, intro: 12 }), items.slice(2, 7));
  const staffCard = mk(company, staff, "Sara Al Thani", "Head of Sales", "Gulf Studio", "sara", company.brand.design, [{ kind: "Mobile", value: "+974 5555 0100" }, { kind: "Email", value: "sara@gulfstudio.example" }, { kind: "Custom", value: "github.com/gulfstudio", label: "GitHub", icon: { type: "brand", key: "github", image_url: null } }, { kind: "Custom", value: "me@gmail.com", label: "Email (Gmail)", icon: { type: "brand", key: "gmail", image_url: null } }]);
  mk(company, demo, "Jasir Vadakkedath", "Managing Director", "Gulf Studio", "jasir-gulf", company.brand.design, [{ kind: "Mobile", value: "+974 5555 0199" }, { kind: "Website", value: "gulfstudio.example" }], "draft");
  db.members.find((m) => m.user === staff.id && m.ws === company.id).card_id = staffCard.id;
  // some leads and invoices
  const names = [["Marcus Reid", "Northwind Labs", "nfc"], ["Aiko Tanaka", "Studio Kobo", "qr"], ["Samuel Ortiz", "Bright Path", "link"], ["Leah Brandt", "Freelance", "email"], ["Tom Hughes", "Hughes Capital", "nfc"]];
  names.forEach(([n, c, s], i) => db.leads.push({ id: id(), card_id: db.cards[0].id, card_name: db.cards[0].name, name: n, email: n.split(" ")[0].toLowerCase() + "@example.com", phone: "+44 7700 90012" + i, company: c, note: i === 1 ? "Met at the expo" : "", source: s, status: ["new", "contacted", "won", "lost", "new"][i], created_at: days(-i * 2) }));
  db.invoices.push({ id: id(), ws: personal.id, number: "SUB-20260301-00412", amount_minor: 9900, currency: "QAR", plan_code: "business", paid_at: days(-60) });
  db.invoices.push({ id: id(), ws: company.id, number: "SUB-20260410-00501", amount_minor: 19500, currency: "QAR", plan_code: "company", paid_at: days(-30) });
}
seed();

// ---- helpers
const subOf = (ws) => {
  const s = ws.sub;
  const used = db.members.filter((m) => m.ws === ws.id && m.status !== "suspended").length;
  const graceEnd = s.ends_at ? new Date(new Date(s.ends_at).getTime() + (s.plan_code === "free" ? 0 : 7) * 86400000).toISOString() : null;
  const live = s.status !== "none" && s.ends_at && Date.now() <= new Date(graceEnd).getTime();
  return { status: s.status === "active" && Date.now() > new Date(s.ends_at).getTime() ? "expired" : s.status, plan_code: s.plan_code, seats_total: s.seats_total, seats_used: ws.kind === "company" ? used : Math.min(1, used), starts_at: s.starts_at, ends_at: s.ends_at, grace_ends_at: s.status === "none" ? null : graceEnd, live: !!live };
};
const roleOf = (ws, user) => db.members.find((m) => m.ws === ws.id && m.user === user.id && m.status !== "suspended")?.role ?? null;
const cardPublic = (c) => {
  const ws = db.workspaces.find((w) => w.id === c.workspace_id);
  const owner = c.owner_id ? db.users.find((u) => u.id === c.owner_id) : null;
  const locked = ws.kind === "company" && ws.brand?.lock_design;
  return {
    id: c.id, workspace_id: c.workspace_id, owner: owner ? { id: owner.id, full_name: owner.full_name, email: owner.email } : null, public_code: c.public_code,
    public_url: `${WEB}/c/${c.slug || c.public_code}`, slug: c.slug, status: c.status, name: c.name, title: c.title, company: c.company, address: c.address, photo_url: c.photo_url, cover_url: c.cover_url ?? null,
    save_contact: c.save_contact, vc: c.vc, design: locked ? ws.brand.design : c.design, items: c.items.map((it, i) => ({ ...it, order: i })), created_at: c.created_at, updated_at: c.updated_at, stats: statsOf(c),
  };
};
const statsOf = (c) => {
  const ev = db.events.filter((e) => e.card === c.id);
  return { views: 100 + ev.filter((e) => e.type === "view").length * 1 + (c.name.length * 17) % 300, scans: 40 + ev.filter((e) => e.source === "qr").length, saves: 12 + ev.filter((e) => e.type === "save").length, leads: db.leads.filter((l) => l.card_id === c.id).length };
};
function badLink(it) {
  const v = String(it.value ?? "").replace(/[\u0000-\u0020]/g, "");
  const m = /^([a-z][a-z0-9+-]*:)/i.exec(v);
  if (m && !ALLOWED.includes(m[1].toLowerCase())) return true;
  return false;
}
class HttpError extends Error { constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; } }
const E = (s, c, m, f) => new HttpError(s, c, m, f);

// ---- multipart
function parseMultipart(buf, ct) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct || "");
  if (!m) return {};
  const boundary = Buffer.from("--" + (m[1] || m[2]));
  const parts = {};
  let pos = buf.indexOf(boundary);
  while (pos >= 0) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next < 0) break;
    const part = buf.subarray(pos + boundary.length + 2, next - 2);
    const headEnd = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, headEnd).toString();
    const name = /name="([^"]+)"/.exec(head)?.[1];
    const type = /Content-Type:\s*([^\r\n]+)/i.exec(head)?.[1];
    if (name) parts[name] = { type, data: part.subarray(headEnd + 4) };
    pos = next;
  }
  return parts;
}
function storeMedia(part) {
  if (!part) throw E(400, "validation_error", "Choose a file.", { file: ["This field is required."] });
  const mid = id();
  db.media.set(mid, part);
  return `${BASE}/media/${mid}`;
}

// ---- vcard
const vq = (s) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
function vcardOf(c) {
  const o = c.vc;
  const parts = c.name.trim().split(/\s+/);
  const first = parts.shift() || "";
  const L = ["BEGIN:VCARD", "VERSION:3.0", `N:${vq(parts.join(" "))};${vq(first)};;;`, `FN:${vq(c.name)}`];
  if (o.company && c.company) L.push(`ORG:${vq(c.company)}`);
  if (c.title) L.push(`TITLE:${vq(c.title)}`);
  const seen = new Set();
  let n = 0;
  const SOC = ["Facebook", "Instagram", "LinkedIn", "X", "YouTube", "TikTok", "Snapchat", "Telegram", "Pinterest", "Threads", "GitHub", "Behance", "Dribbble", "Discord", "Spotify", "SoundCloud", "Twitch", "Reddit", "Medium"];
  const http = (v) => (/^https?:\/\//i.test(v) ? v : "https://" + v);
  for (const it of c.items.filter((i) => i.on && i.value)) {
    if (["Mobile", "Landline", "WhatsApp"].includes(it.kind) && o.phones) {
      const d = it.value.replace(/\D/g, "");
      if (it.kind === "WhatsApp" && seen.has(d)) continue;
      seen.add(d);
      L.push(`TEL;TYPE=${it.kind === "Landline" ? "WORK,VOICE" : "CELL"}:${it.value}`);
    } else if (it.kind === "Email" && o.emails) L.push(`EMAIL;TYPE=INTERNET,WORK:${it.value}`);
    else if (SOC.includes(it.kind) && o.social) { n++; L.push(`item${n}.URL:${http(it.value)}`, `item${n}.X-ABLabel:${it.kind}`); }
    else if (["Website", "Custom", "Calendly", "AppStore", "GooglePlay", "PayPal", "Location"].includes(it.kind) && o.urls) { n++; L.push(`item${n}.URL:${http(it.value)}`, `item${n}.X-ABLabel:${vq(it.kind === "Custom" ? it.label || "link" : it.kind)}`); }
  }
  if (o.addr && c.address) L.push(`ADR;TYPE=WORK:;;${vq(c.address)};;;;`);
  n++;
  L.push(`item${n}.URL:${WEB}/c/${c.slug || c.public_code}`, `item${n}.X-ABLabel:my card`);
  if (o.photo) L.push("PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ");
  if (o.note) L.push(`NOTE:${vq(o.note)}`);
  L.push("END:VCARD");
  return L.join("\r\n") + "\r\n";
}

// ---- analytics (stable pseudo-random so charts look alive)
function rng(seed) { let s = seed; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
function analytics(ws, daysN, cardId) {
  const cards = db.cards.filter((c) => c.workspace_id === ws.id && (!cardId || c.id === cardId));
  const r = rng(daysN * 7 + cards.length);
  const series = Array.from({ length: daysN }, (_, i) => {
    const d = new Date(Date.now() - (daysN - 1 - i) * 86400000).toISOString().slice(0, 10);
    const base = (24 + r() * 30) * (1 + 0.3 * Math.sin((i / 7) * Math.PI * 2)) * Math.max(1, cards.length * 0.7);
    return { date: d, views: Math.round(base), saves: Math.round(base * 0.09), leads: Math.round(base * 0.03) };
  });
  const sum = (k) => series.reduce((a, s) => a + s[k], 0);
  const views = sum("views");
  const totals = { views, unique_visitors: Math.round(views * 0.74), scans: Math.round(views * 0.31), taps: Math.round(views * 0.46), saves: sum("saves"), leads: sum("leads"), link_clicks: Math.round(views * 0.41) };
  const prev = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.max(0, Math.round(v * (0.8 + r() * 0.35)))]));
  return {
    totals, prev_totals: prev, series,
    sources: [{ key: "nfc", count: Math.round(views * 0.42) }, { key: "qr", count: Math.round(views * 0.31) }, { key: "link", count: Math.round(views * 0.17) }, { key: "email", count: Math.round(views * 0.07) }, { key: "other", count: Math.round(views * 0.03) }],
    locations: [{ country: "United Arab Emirates", count: Math.round(views * 0.5) }, { country: "Qatar", count: Math.round(views * 0.2) }, { country: "Saudi Arabia", count: Math.round(views * 0.12) }, { country: "United Kingdom", count: Math.round(views * 0.08) }, { country: "unknown", count: Math.round(views * 0.05) }],
    devices: [{ key: "ios", count: Math.round(views * 0.6) }, { key: "android", count: Math.round(views * 0.33) }, { key: "desktop", count: Math.round(views * 0.06) }, { key: "other", count: Math.round(views * 0.01) }],
    hours: [2, 1, 1, 0, 1, 3, 8, 16, 22, 26, 24, 20, 18, 19, 21, 23, 22, 19, 15, 11, 8, 6, 4, 3].map((v) => Math.round(v * views / 300)),
    top_buttons: [{ kind: "Mobile", count: 120 }, { kind: "WhatsApp", count: 96 }, { kind: "Instagram", count: 44 }, { kind: "Website", count: 31 }, { kind: "Email", count: 19 }],
    cards: cards.map((c) => ({ card_id: c.id, name: c.name, views: Math.round(views / Math.max(1, cards.length)), saves: Math.round(totals.saves / Math.max(1, cards.length)), leads: Math.round(totals.leads / Math.max(1, cards.length)) })),
  };
}

// ---- server
const readBody = (req) => new Promise((resolve) => { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => resolve(Buffer.concat(ch))); });
function send(res, status, body, headers = {}) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", ...headers };
  if (body === undefined) { res.writeHead(status, h); return res.end(); }
  if (typeof body === "string" || Buffer.isBuffer(body)) { res.writeHead(status, h); return res.end(body); }
  res.writeHead(status, { "Content-Type": "application/json", ...h });
  res.end(JSON.stringify(body));
}
const issue = (user) => {
  const access = "at_" + crypto.randomBytes(16).toString("hex");
  const refresh = "rt_" + crypto.randomBytes(16).toString("hex");
  db.tokens.set(access, { user: user.id, exp: Date.now() + 60 * 60 * 1000 });
  db.refresh.set(refresh, user.id);
  return { access, refresh };
};
const userOut = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, photo_url: u.photo_url, created_at: u.created_at });
function wsOut(ws, user) {
  return { id: ws.id, kind: ws.kind, name: ws.name, role: roleOf(ws, user), brand: ws.brand ?? { company_name: ws.name, logo_url: null, website: "", design: DESIGN(), lock_design: false, show_footer: true }, custom_domain: ws.custom_domain, subscription: subOf(ws) };
}
function memberOut(m) {
  const u = m.user ? db.users.find((x) => x.id === m.user) : null;
  return { id: m.id, user: u ? { id: u.id, full_name: u.full_name, email: u.email, photo_url: u.photo_url } : null, email: m.email, full_name: m.full_name, role: m.role, status: m.status, card_id: m.card_id, invited_at: m.invited_at, joined_at: m.joined_at };
}

async function route(req, res, url, raw) {
  const p = url.pathname.replace(/^\/api\/v1\//, "").replace(/\/$/, "");
  const q = url.searchParams;
  const m = req.method;
  const ct = req.headers["content-type"] || "";
  const body = ct.includes("json") && raw.length ? JSON.parse(raw.toString()) : {};
  const auth = req.headers.authorization?.replace(/^Bearer /, "");
  const tk = auth && db.tokens.get(auth);
  const user = tk && tk.exp > Date.now() ? db.users.find((u) => u.id === tk.user) : null;
  const need = () => { if (!user) throw E(401, "unauthorized", "Please sign in again."); return user; };
  const wsFor = (wid, roles) => {
    need();
    const ws = db.workspaces.find((w) => w.id === wid);
    if (!ws) throw E(404, "not_found", "Workspace not found.");
    const role = roleOf(ws, user);
    if (!role) throw E(403, "forbidden", "You do not have access to this workspace.");
    if (roles && !roles.includes(role)) throw E(403, "forbidden", "Only owners and admins can do this.");
    return { ws, role };
  };
  const cardFor = (cid, manageOnly = false) => {
    need();
    const c = db.cards.find((x) => x.id === cid);
    if (!c) throw E(404, "not_found", "Card not found.");
    const ws = db.workspaces.find((w) => w.id === c.workspace_id);
    const role = roleOf(ws, user);
    if (!role || (role === "employee" && c.owner_id !== user.id)) throw E(403, "forbidden", "You do not have access to this card.");
    return { c, ws, role };
  };
  let r;

  // ---- auth
  if (p === "auth/register" && m === "POST") {
    if (db.users.some((u) => u.email === body.email?.toLowerCase())) throw E(409, "email_taken", "There is already an account with this email.");
    if (!body.password || body.password.length < 8) throw E(400, "validation_error", "Check the highlighted fields.", { password: ["Use at least 8 characters."] });
    const u = { id: id(), email: body.email.toLowerCase(), full_name: body.full_name, photo_url: null, created_at: now(), password: body.password };
    db.users.push(u);
    const ws = { id: id(), kind: "personal", name: "Personal", owner: u.id, custom_domain: null, brand: null, sub: { status: "none", plan_code: null, seats_total: 1, starts_at: null, ends_at: null } };
    db.workspaces.push(ws);
    db.members.push({ id: id(), ws: ws.id, user: u.id, email: u.email, full_name: u.full_name, role: "owner", status: "active", card_id: null, invited_at: now(), joined_at: now() });
    return send(res, 201, { user: userOut(u), ...issue(u) });
  }
  if (p === "auth/login" && m === "POST") {
    const u = db.users.find((x) => x.email === String(body.email).toLowerCase() && x.password === body.password);
    if (!u) throw E(401, "invalid_credentials", "The email or password is not right.");
    return send(res, 200, { user: userOut(u), ...issue(u) });
  }
  if (p === "auth/refresh" && m === "POST") {
    const uid = db.refresh.get(body.refresh);
    if (!uid) throw E(401, "unauthorized", "Please sign in again.");
    db.refresh.delete(body.refresh);
    return send(res, 200, issue(db.users.find((u) => u.id === uid)));
  }
  if (p === "auth/me") {
    need();
    if (m === "PATCH") { if (body.full_name) user.full_name = body.full_name; }
    return send(res, 200, userOut(user));
  }
  if (p === "auth/forgot" && m === "POST") return send(res, 204);
  if (p === "auth/reset" && m === "POST") {
    if (body.token === "expired") throw E(400, "validation_error", "Bad link.", { token: ["This link has expired."] });
    return send(res, 204);
  }
  if (p === "auth/change-password" && m === "POST") {
    need();
    if (user.password !== body.old_password) throw E(400, "validation_error", "Check the highlighted fields.", { old_password: ["That is not your current password."] });
    user.password = body.new_password;
    return send(res, 204);
  }
  if (p === "me/workspaces") {
    need();
    return send(res, 200, db.workspaces.filter((w) => roleOf(w, user)).map((w) => ({ id: w.id, kind: w.kind, name: w.name, role: roleOf(w, user), card_count: db.cards.filter((c) => c.workspace_id === w.id && (roleOf(w, user) !== "employee" || c.owner_id === user.id)).length, subscription: subOf(w) })));
  }

  // ---- plans
  if (p === "plans") return send(res, 200, PLANS);
  if ((r = /^workspaces\/([^/]+)\/checkout$/.exec(p)) && m === "POST") {
    const { ws } = wsFor(r[1], ["owner", "admin"]);
    const plan = PLANS.find((x) => x.code === body.plan_code);
    if (!plan) throw E(400, "validation_error", "Unknown plan.", { plan_code: ["Unknown plan."] });
    const seats = plan.per_seat ? Math.max(plan.min_seats, body.seats || plan.min_seats) : 1;
    ws.sub = { status: "active", plan_code: plan.code, seats_total: seats, starts_at: now(), ends_at: days(365) };
    db.invoices.push({ id: id(), ws: ws.id, number: `SUB-${Date.now()}`, amount_minor: plan.per_seat ? plan.price_minor * seats : plan.price_minor, currency: plan.currency, plan_code: plan.code, paid_at: now() });
    return send(res, 200, { checkout_url: `${WEB}/app/billing?paid=1` });
  }
  if ((r = /^workspaces\/([^/]+)\/subscription$/.exec(p))) return send(res, 200, subOf(wsFor(r[1]).ws));
  if ((r = /^workspaces\/([^/]+)\/invoices$/.exec(p))) { const { ws } = wsFor(r[1], ["owner", "admin"]); return send(res, 200, db.invoices.filter((i) => i.ws === ws.id).map(({ ws: _w, ...i }) => i)); }

  // ---- workspaces
  if (p === "workspaces" && m === "POST") {
    need();
    const ws = { id: id(), kind: "company", name: body.name, owner: user.id, custom_domain: null, brand: { company_name: body.name, logo_url: null, website: "", design: DESIGN(), lock_design: false, show_footer: true }, sub: { status: "none", plan_code: null, seats_total: 0, starts_at: null, ends_at: null } };
    db.workspaces.push(ws);
    db.members.push({ id: id(), ws: ws.id, user: user.id, email: user.email, full_name: user.full_name, role: "owner", status: "active", card_id: null, invited_at: now(), joined_at: now() });
    return send(res, 201, wsOut(ws, user));
  }
  if ((r = /^workspaces\/([^/]+)$/.exec(p))) {
    const { ws } = wsFor(r[1], m === "PATCH" ? ["owner", "admin"] : undefined);
    if (m === "PATCH") {
      if (body.name) ws.name = body.name;
      if (body.brand && ws.brand) ws.brand = { ...ws.brand, ...body.brand };
      if ("custom_domain" in body) ws.custom_domain = body.custom_domain;
    }
    return send(res, 200, wsOut(ws, user));
  }
  if ((r = /^workspaces\/([^/]+)\/logo$/.exec(p)) && m === "POST") {
    const { ws } = wsFor(r[1], ["owner", "admin"]);
    const url2 = storeMedia(parseMultipart(raw, ct).file);
    if (ws.brand) ws.brand.logo_url = url2;
    return send(res, 200, { logo_url: url2 });
  }

  // ---- cards
  if ((r = /^workspaces\/([^/]+)\/cards$/.exec(p))) {
    const { ws, role } = wsFor(r[1]);
    if (m === "GET") return send(res, 200, db.cards.filter((c) => c.workspace_id === ws.id && (role !== "employee" || c.owner_id === user.id)).map(cardPublic));
    if (m === "POST") {
      const sub = subOf(ws);
      const plan = PLANS.find((x) => x.code === sub.plan_code);
      const count = db.cards.filter((c) => c.workspace_id === ws.id).length;
      // As in the real API: a card can be built before paying (one draft); publishing starts the free week.
      const limit = !sub.live || !plan ? 1 : plan.per_seat ? sub.seats_total : plan.max_cards;
      if (count >= limit) throw E(403, "plan_limit", `Your plan allows ${limit} card${limit === 1 ? "" : "s"}. Upgrade to add more.`);
      const c = { id: id(), workspace_id: ws.id, owner_id: user.id, public_code: code(), slug: null, status: "draft", name: body.name || user.full_name, title: "", company: ws.brand?.company_name || "", address: "", photo_url: null, cover_url: null, save_contact: true, vc: { ...DEFAULT_VC }, design: ws.brand?.design ?? DESIGN(), items: [{ id: id(), kind: "Mobile", value: "", label: "", on: true, icon: null, order: 0 }], created_at: now(), updated_at: now(), slugs: [] };
      db.cards.push(c);
      return send(res, 201, cardPublic(c));
    }
  }
  if ((r = /^cards\/([^/]+)$/.exec(p))) {
    const { c, ws, role } = cardFor(r[1]);
    if (m === "GET") return send(res, 200, cardPublic(c));
    if (m === "DELETE") { if (role === "employee") throw E(403, "forbidden", "Only owners and admins can delete cards."); db.cards.splice(db.cards.indexOf(c), 1); return send(res, 204); }
    if (m === "PATCH") {
      const locked = ws.kind === "company" && ws.brand?.lock_design;
      for (const k of ["name", "title", "company", "address", "save_contact", "vc"]) if (k in body) c[k] = body[k];
      if ("design" in body && !locked) c.design = { ...c.design, ...body.design };
      if ("slug" in body) {
        if (body.slug && db.cards.some((x) => x.id !== c.id && (x.slug === body.slug || x.slugs.includes(body.slug)))) throw E(409, "slug_taken", "That address is taken.");
        c.slug = body.slug || null;
        if (body.slug) c.slugs.push(body.slug);
      }
      if ("items" in body) {
        if (!Array.isArray(body.items)) throw E(400, "validation_error", "Bad items.", { items: ["Expected a list."] });
        if (body.items.length > 40) throw E(400, "validation_error", "A card can have up to 40 buttons.", { items: ["A card can have at most 40 buttons."] });
        const bad = body.items.find(badLink);
        if (bad) throw E(400, "validation_error", "One of the links is not allowed.", { items: [`The link "${String(bad.value).slice(0, 30)}" is not allowed.`] });
        c.items = body.items.map((it, i) => ({ id: it.id || id(), kind: it.kind, value: String(it.value ?? ""), label: String(it.label ?? "").slice(0, 40), on: it.on !== false, icon: it.icon ?? null, order: i }));
      }
      c.updated_at = now();
      return send(res, 200, cardPublic(c));
    }
  }
  if ((r = /^cards\/([^/]+)\/photo$/.exec(p)) && m === "POST") { const { c } = cardFor(r[1]); c.photo_url = storeMedia(parseMultipart(raw, ct).file); return send(res, 200, { photo_url: c.photo_url }); }
  if ((r = /^cards\/([^/]+)\/cover$/.exec(p)) && m === "POST") {
    const { c } = cardFor(r[1]);
    const part = parseMultipart(raw, ct).file;
    if (part?.type === "image/svg+xml") throw E(400, "validation_error", "SVG files are not accepted.", { file: ["SVG files are not accepted."] });
    c.cover_url = storeMedia(part);
    return send(res, 200, { cover_url: c.cover_url });
  }
  if ((r = /^cards\/([^/]+)\/icon$/.exec(p)) && m === "POST") {
    cardFor(r[1]);
    const part = parseMultipart(raw, ct).file;
    if (part?.type === "image/svg+xml") throw E(400, "validation_error", "SVG files are not accepted.", { file: ["SVG files are not accepted."] });
    return send(res, 200, { image_url: storeMedia(part) });
  }
  if ((r = /^cards\/([^/]+)\/(publish|unpublish|duplicate)$/.exec(p)) && m === "POST") {
    const { c, ws } = cardFor(r[1]);
    if (r[2] === "duplicate") {
      const n = { ...JSON.parse(JSON.stringify(c)), id: id(), public_code: code(), slug: null, slugs: [], status: "draft", name: c.name + " copy", created_at: now(), updated_at: now() };
      db.cards.push(n);
      return send(res, 201, cardPublic(n));
    }
    if (r[2] === "publish") { if (ws.kind === "personal" && ws.sub.status === "none") ws.sub = { status: "active", plan_code: "free", seats_total: 1, starts_at: now(), ends_at: days(7) }; if (!subOf(ws).live) throw E(402, "subscription_required", "Choose a plan to publish your card."); c.status = "published"; } else c.status = "draft";
    return send(res, 200, cardPublic(c));
  }
  if (p === "slugs/check") {
    const s = (q.get("slug") || "").toLowerCase();
    const taken = ["admin", "login", "app", "api"].includes(s) || db.cards.some((c) => c.slug === s || c.slugs.includes(s));
    return send(res, 200, { available: !taken, suggestion: taken ? s + "-" + crypto.randomInt(10, 99) : null });
  }
  if (p === "tools/resolve-link" && m === "POST") {
    need();
    let u = String(body.url || "").trim();
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    let host = "";
    try { host = new URL(u).hostname; } catch { return send(res, 200, { url: u, title: null, favicon_url: null }); }
    const title = host.replace(/^www\./, "").split(".")[0];
    return send(res, 200, { url: u, title: title.charAt(0).toUpperCase() + title.slice(1), favicon_url: null });
  }

  // ---- team
  if ((r = /^workspaces\/([^/]+)\/members$/.exec(p))) { const { ws } = wsFor(r[1], ["owner", "admin"]); return send(res, 200, db.members.filter((x) => x.ws === ws.id).map(memberOut)); }
  if ((r = /^workspaces\/([^/]+)\/invites$/.exec(p)) && m === "POST") {
    const { ws } = wsFor(r[1], ["owner", "admin"]);
    const sub = subOf(ws);
    const list = body.invites || [];
    if (db.members.filter((x) => x.ws === ws.id && x.status !== "suspended").length + list.length > sub.seats_total) throw E(403, "plan_limit", "You do not have enough free seats. Buy more seats to invite them.");
    const out = list.map((i) => {
      const card = { id: id(), workspace_id: ws.id, owner_id: null, public_code: code(), slug: null, status: "draft", name: i.full_name || i.email.split("@")[0], title: i.title || "", company: ws.brand.company_name, address: "", photo_url: null, cover_url: null, save_contact: true, vc: { ...DEFAULT_VC }, design: ws.brand.design, items: [], created_at: now(), updated_at: now(), slugs: [] };
      db.cards.push(card);
      const mem = { id: id(), ws: ws.id, user: null, email: i.email, full_name: i.full_name || "", role: i.role || "employee", status: "invited", card_id: card.id, invited_at: now(), joined_at: null };
      db.members.push(mem);
      const token = crypto.randomBytes(12).toString("hex");
      db.invites.push({ token, member: mem.id });
      console.log(`[mock] invite for ${i.email}: ${WEB}/join/${token}`);
      return memberOut(mem);
    });
    return send(res, 201, out);
  }
  if ((r = /^invites\/([^/]+)$/.exec(p))) {
    const inv = db.invites.find((i) => i.token === r[1]);
    if (!inv) throw E(410, "invite_invalid", "This invitation is not valid.");
    const mem = db.members.find((x) => x.id === inv.member);
    return send(res, 200, { workspace_name: db.workspaces.find((w) => w.id === mem.ws).name, email: mem.email, full_name: mem.full_name });
  }
  if ((r = /^invites\/([^/]+)\/accept$/.exec(p)) && m === "POST") {
    const inv = db.invites.find((i) => i.token === r[1]);
    if (!inv) throw E(410, "invite_invalid", "This invitation is not valid.");
    const mem = db.members.find((x) => x.id === inv.member);
    let u = db.users.find((x) => x.email === mem.email);
    if (!u) {
      if (!body.password) throw E(400, "validation_error", "Choose a password.", { password: ["Choose a password to create your account."] });
      u = { id: id(), email: mem.email, full_name: body.full_name || mem.full_name || mem.email, photo_url: null, created_at: now(), password: body.password };
      db.users.push(u);
    }
    mem.user = u.id; mem.status = "active"; mem.joined_at = now();
    const card = db.cards.find((c) => c.id === mem.card_id);
    if (card) card.owner_id = u.id;
    db.invites.splice(db.invites.indexOf(inv), 1);
    return send(res, 200, { ...issue(u), workspace_id: mem.ws });
  }
  if ((r = /^workspaces\/([^/]+)\/members\/import$/.exec(p)) && m === "POST") {
    const { ws } = wsFor(r[1], ["owner", "admin"]);
    const text = (parseMultipart(raw, ct).file?.data || Buffer.alloc(0)).toString();
    const rows = text.split(/\r?\n/).filter(Boolean).slice(1);
    let created = 0;
    const skipped = [];
    rows.forEach((line, i) => {
      const [email, full_name, title] = line.split(",").map((s) => s?.trim());
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return skipped.push({ row: i + 2, reason: "Not a valid email" });
      if (db.members.some((x) => x.ws === ws.id && x.email === email)) return skipped.push({ row: i + 2, reason: "Already on the team" });
      db.members.push({ id: id(), ws: ws.id, user: null, email, full_name: full_name || "", role: "employee", status: "invited", card_id: null, invited_at: now(), joined_at: null, title });
      created++;
    });
    return send(res, 200, { created, skipped });
  }
  if ((r = /^workspaces\/([^/]+)\/members\/([^/]+)$/.exec(p))) {
    const { ws } = wsFor(r[1], ["owner", "admin"]);
    const mem = db.members.find((x) => x.id === r[2] && x.ws === ws.id);
    if (!mem) throw E(404, "not_found", "Member not found.");
    if (m === "PATCH") { if (body.role) mem.role = body.role; if (body.status) mem.status = body.status; return send(res, 200, memberOut(mem)); }
    if (m === "DELETE") { db.members.splice(db.members.indexOf(mem), 1); const c = db.cards.find((x) => x.id === mem.card_id); if (c) c.status = "suspended"; return send(res, 204); }
  }

  // ---- leads, analytics
  if ((r = /^workspaces\/([^/]+)\/leads\.csv$/.exec(p))) {
    const { ws } = wsFor(r[1], ["owner", "admin"]);
    const ids = db.cards.filter((c) => c.workspace_id === ws.id).map((c) => c.id);
    const rows = db.leads.filter((l) => ids.includes(l.card_id));
    return send(res, 200, "name,email,phone,company,note,source,status,created_at\n" + rows.map((l) => [l.name, l.email, l.phone, l.company, l.note, l.source, l.status, l.created_at].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"), { "Content-Type": "text/csv; charset=utf-8" });
  }
  if ((r = /^workspaces\/([^/]+)\/leads$/.exec(p))) {
    const { ws, role } = wsFor(r[1]);
    const mine = db.cards.filter((c) => c.workspace_id === ws.id && (role !== "employee" || c.owner_id === user.id)).map((c) => c.id);
    let rows = db.leads.filter((l) => mine.includes(l.card_id));
    if (q.get("card_id")) rows = rows.filter((l) => l.card_id === q.get("card_id"));
    if (q.get("status")) rows = rows.filter((l) => l.status === q.get("status"));
    const s = (q.get("q") || "").toLowerCase();
    if (s) rows = rows.filter((l) => [l.name, l.email, l.company].some((v) => v.toLowerCase().includes(s)));
    const off = Number(q.get("offset") || 0), lim = Number(q.get("limit") || 50);
    return send(res, 200, { count: rows.length, results: rows.slice(off, off + lim) });
  }
  if ((r = /^leads\/([^/]+)$/.exec(p)) && m === "PATCH") { need(); const l = db.leads.find((x) => x.id === r[1]); if (!l) throw E(404, "not_found", "Not found."); l.status = body.status; return send(res, 200, l); }
  if ((r = /^workspaces\/([^/]+)\/analytics$/.exec(p))) { const { ws } = wsFor(r[1], ["owner", "admin"]); return send(res, 200, analytics(ws, Number(q.get("days") || 30), q.get("card_id") || null)); }

  // ---- public
  if ((r = /^public\/cards\/([^/]+)$/.exec(p)) && m === "GET") {
    const key = r[1];
    if (key === "pausedco") return send(res, 200, { state: "paused", company_name: "Gulf Studio", message: "This card is paused while the company renews its plan." });
    if (key === "removed01") return send(res, 200, { state: "suspended", company_name: "Gulf Studio", website: "gulfstudio.example", message: "This person no longer works with Gulf Studio." });
    const c = db.cards.find((x) => x.public_code === key || x.slug === key || x.slugs.includes(key));
    if (!c) throw E(404, "not_found", "Card not found.");
    const ws = db.workspaces.find((w) => w.id === c.workspace_id);
    if (c.status === "suspended") return send(res, 200, { state: "suspended", company_name: ws.brand?.company_name ?? null, website: ws.brand?.website ?? null, message: "This card is no longer available." });
    if (!subOf(ws).live || c.status !== "published") return send(res, 200, { state: "paused", company_name: ws.brand?.company_name ?? null, message: "This card is not available right now." });
    const full = cardPublic(c);
    const canonical = c.slug || c.public_code;
    return send(res, 200, {
      state: "live", canonical,
      card: { name: c.name, title: c.title, company: c.company, address: c.address, photo_url: c.photo_url, cover_url: c.cover_url ?? null, items: full.items.filter((i) => i.on && i.value).map(({ kind, value, label, icon }) => ({ kind, value, label, icon })), save_contact: c.save_contact, design: full.design, footer: ws.kind === "company" ? ws.brand.show_footer : c.design.foot, brand: ws.kind === "company" ? { company_name: ws.brand.company_name, logo_url: ws.brand.logo_url } : null, public_url: full.public_url, vcard_url: `${BASE}/api/v1/public/cards/${c.public_code}/vcard`, qr_url: `${BASE}/api/v1/public/cards/${c.public_code}/qr.svg` },
      og: { title: `${c.name}${c.title ? ", " + c.title : ""}`, description: c.company || "Digital business card", image_url: c.photo_url },
    });
  }
  if ((r = /^public\/cards\/([^/]+)\/events$/.exec(p)) && m === "POST") {
    const c = db.cards.find((x) => x.public_code === r[1] || x.slug === r[1]);
    if (c) db.events.push({ card: c.id, type: body.type, source: body.source, kind: body.kind });
    console.log(`[mock] event ${body.type} ${body.source ?? ""} ${body.kind ?? ""} on ${r[1]}`);
    return send(res, 204);
  }
  if ((r = /^public\/cards\/([^/]+)\/leads$/.exec(p)) && m === "POST") {
    const c = db.cards.find((x) => x.public_code === r[1] || x.slug === r[1]);
    if (!c) throw E(404, "not_found", "Card not found.");
    if (body.website_url) return send(res, 201, {});
    if (!body.name) throw E(400, "validation_error", "Please enter your name.", { name: ["This field is required."] });
    if (!body.email && !body.phone) throw E(400, "validation_error", "Please add an email or a phone number.", { email: ["Add an email or a phone number."] });
    db.leads.unshift({ id: id(), card_id: c.id, card_name: c.name, name: body.name, email: body.email || "", phone: body.phone || "", company: body.company || "", note: body.note || "", source: "link", status: "new", created_at: now() });
    return send(res, 201, {});
  }
  if ((r = /^public\/cards\/([^/]+)\/vcard$/.exec(p))) {
    const c = db.cards.find((x) => x.public_code === r[1] || x.slug === r[1]);
    if (!c) throw E(404, "not_found", "Card not found.");
    return send(res, 200, vcardOf(c), { "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${c.name.replace(/\s+/g, "-")}.vcf"` });
  }
  if ((r = /^public\/cards\/([^/]+)\/qr\.svg$/.exec(p))) {
    const c = db.cards.find((x) => x.public_code === r[1] || x.slug === r[1]);
    if (!c) throw E(404, "not_found", "Card not found.");
    const svg = await QRCode.toString(`${WEB}/c/${c.slug || c.public_code}?s=qr`, { type: "svg", margin: 2, width: Number(q.get("size") || 512) });
    return send(res, 200, svg, { "Content-Type": "image/svg+xml" });
  }
  if ((r = /^\/?media\/([^/]+)$/.exec(url.pathname.replace(/^\//, "")))) {
    const f = db.media.get(r[1]);
    if (!f) throw E(404, "not_found", "Not found.");
    return send(res, 200, f.data, { "Content-Type": f.type || "application/octet-stream" });
  }
  throw E(404, "not_found", `No route for ${m} ${p}`);
}

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, BASE);
    try {
      const raw = await readBody(req);
      if (url.pathname.startsWith("/media/")) return await route(req, res, url, raw);
      await route(req, res, url, raw);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } });
      console.error(e);
      send(res, 500, { error: { code: "server_error", message: "Something went wrong." } });
    }
  })
  .listen(PORT, () => {
    console.log(`Mock API on ${BASE}/api/v1  (demo@ilaf.test / demo1234, staff@ilaf.test / demo1234)`);
    for (const c of db.cards) console.log(`  card ${c.name} -> ${WEB}/c/${c.slug || c.public_code}`);
  });
