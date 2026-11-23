// The small proof of work of the public contact form: find a number so that sha256("<challenge>:<number>") starts with
// `difficulty` zero hex digits. No third-party captcha; the server signs the challenge and accepts it once.

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when the hash of this attempt meets the difficulty. */
export async function meetsDifficulty(challenge: string, counter: number, difficulty: number): Promise<boolean> {
  return (await sha256Hex(`${challenge}:${counter}`)).startsWith("0".repeat(difficulty));
}

/** Search for a counter. Yields to the browser every `batch` attempts so the page stays responsive. */
export async function solveChallenge(challenge: string, difficulty: number, batch = 200, signal?: { cancelled: boolean }): Promise<number | null> {
  const prefix = "0".repeat(difficulty);
  for (let counter = 0; counter < 50_000_000; counter++) {
    if ((await sha256Hex(`${challenge}:${counter}`)).startsWith(prefix)) return counter;
    if (counter % batch === batch - 1) {
      if (signal?.cancelled) return null;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return null;
}
