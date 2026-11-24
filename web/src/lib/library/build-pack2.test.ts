import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Design Pack 2 build (scripts/build-pack2.mjs) must give the same bytes every time, and the committed outputs
// must be what the designer files in scripts/pack2 produce (a forgotten re-run shows up here).
const WEB = path.join(__dirname, "..", "..", "..");
const OUTPUTS = [
  ["public", "card-library", "designs.css"],
  ["src", "lib", "library", "generated", "engine.js"],
  ["src", "lib", "library", "generated", "meta.ts"],
  ["src", "lib", "library", "generated", "pack2.js"],
  ["src", "lib", "library", "generated", "pack2.d.ts"],
];
const digest = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function buildInto(dir: string): Record<string, string> {
  execFileSync(process.execPath, [path.join(WEB, "scripts", "build-pack2.mjs")], { cwd: WEB, env: { ...process.env, PACK2_OUT_DIR: dir }, stdio: "pipe" });
  return Object.fromEntries(OUTPUTS.map((p) => [p[p.length - 1], digest(path.join(dir, p[p.length - 1]))]));
}

describe("build-pack2", () => {
  it("is deterministic and the committed library is up to date with the designer files", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pack2-"));
    try {
      const first = buildInto(path.join(base, "one"));
      const second = buildInto(path.join(base, "two"));
      expect(second).toEqual(first);
      const committed = Object.fromEntries(OUTPUTS.map((p) => [p[p.length - 1], digest(path.join(WEB, ...p))]));
      expect(committed, "run: npm run build:pack2").toEqual(first);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 60_000);

  it("ships the designer files for all 100 faces", () => {
    const dir = path.join(WEB, "scripts", "pack2");
    const numbers = new Set<number>();
    for (const f of fs.readdirSync(dir).filter((f) => /^cards_.*\.html$/.test(f))) {
      for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/data-no="(\d+)"/g)) numbers.add(Number(m[1]));
    }
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => 401 + i));
  });
});
