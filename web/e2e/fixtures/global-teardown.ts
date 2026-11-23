import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { ARTIFACTS, api } from "./api";

// Test-data clean-up. Every account a test created is written to artifacts/created-users.jsonl; here each one is signed in and asked
// for deletion, so the backend's own purge job removes it after its grace period. Set E2E_KEEP_DATA=1 to skip (for debugging).
// A failure here never fails the run: the data uses unique e-mails, so leftovers cannot disturb later runs.

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA) return;
  const file = path.join(ARTIFACTS, "created-users.jsonl");
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  let removed = 0;
  for (const line of lines) {
    try {
      const { email, password } = JSON.parse(line) as { email: string; password: string };
      const login = await api<{ access: string }>("POST", "auth/login", { body: { email, password }, expect: [200, 400, 401, 403, 423] });
      if (login.status !== 200) continue;
      await api("POST", "privacy/delete-account", { token: login.data.access, body: { confirm: "DELETE", password }, expect: [202, 400, 403, 409] });
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  rmSync(file, { force: true });
  console.log(`e2e clean-up: asked for deletion of ${removed} of ${lines.length} test accounts`);
}
