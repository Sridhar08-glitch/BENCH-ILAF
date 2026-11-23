import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

// The backend (started with EMAIL_FILE_PATH=<folder> and DEBUG=true) writes every outgoing e-mail into that folder.
// The tests read the files here instead of using a real mailbox.

export const MAIL_DIR = path.resolve(process.env.E2E_MAIL_DIR ?? path.join(__dirname, "..", "artifacts", "mail"));

export interface Mail {
  to: string;
  subject: string;
  /** Plain text and HTML parts joined, quoted-printable already decoded. */
  body: string;
}

function decodeQuotedPrintable(text: string): string {
  const joined = text.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i], "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeSubject(raw: string): string {
  return raw.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_m, enc: string, value: string) =>
    enc.toLowerCase() === "b" ? Buffer.from(value, "base64").toString("utf8") : decodeQuotedPrintable(value.replace(/_/g, " ")),
  );
}

function parseMessage(raw: string): Mail {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  const header = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "im").exec(unfolded)?.[1]?.trim() ?? "";
  let body = rest.join("\n\n");
  // Each part can carry its own transfer encoding; decode them all.
  body = body
    .split(/\r?\n/)
    .join("\n")
    .replace(/Content-Transfer-Encoding:\s*base64\s*\n\n([A-Za-z0-9+/=\n]+)/gi, (_m, b64: string) => "\n\n" + Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf8"));
  if (/quoted-printable/i.test(raw)) body = decodeQuotedPrintable(body);
  return { to: header("To"), subject: decodeSubject(header("Subject")), body };
}

/** All mails currently in the folder, oldest first. */
export function readMails(): Mail[] {
  if (!existsSync(MAIL_DIR)) return [];
  const mails: Mail[] = [];
  for (const file of readdirSync(MAIL_DIR).sort()) {
    const text = readFileSync(path.join(MAIL_DIR, file), "utf8");
    // One file holds one connection's messages, separated by a line of dashes.
    for (const chunk of text.split(/\r?\n-{79}\r?\n/)) {
      if (chunk.trim()) mails.push(parseMessage(chunk));
    }
  }
  return mails;
}

/** Waits (polling) for a mail to `to`, optionally with a subject or body pattern. */
export async function waitForMail(to: string, match?: RegExp, timeout = 20_000): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      () => {
        found = readMails()
          .reverse()
          .find((m) => m.to.toLowerCase().includes(to.toLowerCase()) && (!match || match.test(m.subject) || match.test(m.body)));
        return !!found;
      },
      { message: `waiting for a mail to ${to}${match ? ` matching ${match}` : ""}`, timeout },
    )
    .toBe(true);
  return found as Mail;
}

/** The first link in the mail that points at a path of the website (e.g. /reset). */
export function linkTo(mail: Mail, pathStart: string): string {
  const re = new RegExp(`https?://[^\\s"'<>]*${pathStart.replace(/[/.]/g, "\\$&")}[^\\s"'<>]*`, "i");
  const hit = re.exec(mail.body);
  if (!hit) throw new Error(`no link to ${pathStart} in the mail "${mail.subject}":\n${mail.body.slice(0, 600)}`);
  return hit[0].replace(/&amp;/g, "&");
}

/** Turns an absolute link from a mail into the address the test browser must open (the mail may name the production host). */
export function localise(link: string, webUrl: string): string {
  const u = new URL(link);
  return `${webUrl.replace(/\/$/, "")}${u.pathname}${u.search}${u.hash}`;
}

export function clearMails() {
  rmSync(MAIL_DIR, { recursive: true, force: true });
  mkdirSync(MAIL_DIR, { recursive: true });
}
