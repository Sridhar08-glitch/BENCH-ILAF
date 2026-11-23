// Takes screenshots of screens with headless Chrome at exact widths (down to 320 px) and reports
// horizontal overflow. Usage: node scripts/shoot.mjs scripts/shots.json
// Each task: { name, url, width, height?, full?, login?: "demo"|"staff", steps?: [js expression strings], wait? }
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WEB = process.env.WEB || "http://localhost:3100";
const OUT = path.resolve("shots");
const tasks = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USERS = { demo: ["demo@ilaf.test", "demo1234"], staff: ["staff@ilaf.test", "demo1234"] };

async function loginCookies(who) {
  const [email, password] = USERS[who];
  const r = await fetch(`${WEB}/api/session/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error("login failed " + r.status);
  return r.headers.getSetCookie().map((c) => {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: "localhost", path: "/", httpOnly: true };
  });
}

const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shoot-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--disable-gpu", "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let n = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach((l) => l(m));
};
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++n; pending.set(id, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed"); return r.result.value; };

await cdp("Page.enable");
await cdp("Runtime.enable");
listeners.push((m) => {
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) console.log("  console." + m.params.type + ": " + m.params.args.map((a) => (a.value ?? a.description ?? "")).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") console.log("  exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
});
await cdp("Network.enable");
let loggedAs = null;
const report = [];

for (const t of tasks) {
  const width = t.width || 1280;
  const height = t.height || 900;
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  if (t.login && loggedAs !== t.login) {
    await cdp("Network.clearBrowserCookies");
    await cdp("Network.setCookies", { cookies: await loginCookies(t.login) });
    loggedAs = t.login;
  } else if (!t.login && loggedAs) {
    await cdp("Network.clearBrowserCookies");
    loggedAs = null;
  }
  await cdp("Page.navigate", { url: t.url.startsWith("http") ? t.url : WEB + t.url });
  await sleep(t.wait || 3500);
  for (const s of t.steps || []) { const v = await evalJs(s); if (v !== undefined) console.log("  step ->", v); await sleep(t.stepWait || 2500); }
  const over = await evalJs("({sw: document.documentElement.scrollWidth, iw: window.innerWidth, h: document.documentElement.scrollHeight})");
  let clip;
  if (t.full) {
    clip = { x: 0, y: 0, width, height: Math.min(over.h, 6000), scale: 1 };
  }
  const shot = await cdp("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  fs.writeFileSync(path.join(OUT, t.name + ".png"), Buffer.from(shot.data, "base64"));
  const line = `${t.name}: width ${width}, scrollWidth ${over.sw}${over.sw > over.iw ? "  <-- HORIZONTAL SCROLL" : "  ok"}`;
  report.push(line);
  console.log(line);
}
ws.close();
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
