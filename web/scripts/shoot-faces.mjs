// Sets the demo card to several numbered designs on the mock API and screenshots the public page at 320 and 390 px.
// Each combination is [face 1..400, colour 0..3, below 1..400, intro 0..400]. Override with COMBOS='[[1,0,1,1],[44,2,7,12]]'.
// Usage: API=http://localhost:8210/api/v1 WEB=http://localhost:3300 node scripts/shoot-faces.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";

const A = process.env.API || "http://localhost:8210/api/v1";
const WEB = process.env.WEB || "http://localhost:3300";
const combos = process.env.COMBOS ? JSON.parse(process.env.COMBOS) : [[1, 0, 1, 0], [44, 1, 7, 0], [120, 2, 60, 0], [250, 3, 120, 0], [399, 0, 300, 0]];

const rf = async (u, o) => { for (let i = 0; i < 4; i++) { try { return await fetch(u, o); } catch { await new Promise((r) => setTimeout(r, 500)); } } throw new Error("fetch"); };
const L = await (await rf(A + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@ilaf.test", password: "demo1234" }) })).json();
const h = { Authorization: "Bearer " + L.access, "Content-Type": "application/json" };
const ws = (await (await rf(A + "/me/workspaces", { headers: h })).json()).find((w) => w.kind === "personal");
const card = (await (await rf(A + `/workspaces/${ws.id}/cards`, { headers: h })).json())[0];

// a cover picture for the faces that use one
const fd = new FormData();
fd.append("file", new Blob([fs.readFileSync("public/brand/bench-logo.png")], { type: "image/png" }), "cover.png");
await rf(A + `/cards/${card.id}/cover`, { method: "POST", headers: { Authorization: h.Authorization }, body: fd });

const patch = (design) => rf(A + "/cards/" + card.id, { method: "PATCH", headers: h, body: JSON.stringify({ design }) });

for (const [face, colour, below, intro] of combos) {
  await patch({ face, colour, below, intro });
  const name = `face-${face}-${colour}-below-${below}`;
  fs.writeFileSync("scripts/faces.json", JSON.stringify([
    { name: `${name}-320`, url: "/c/jasir", width: 320, height: 700, full: true, wait: 2500 },
    { name: `${name}-390`, url: "/c/jasir", width: 390, height: 800, full: true, wait: 1500 },
  ]));
  console.log(execSync("node scripts/shoot.mjs scripts/faces.json", { env: { ...process.env, WEB } }).toString().trim());
}
fs.rmSync("scripts/faces.json", { force: true });
await patch({ face: 1, colour: 0, below: 1, intro: 1 });
