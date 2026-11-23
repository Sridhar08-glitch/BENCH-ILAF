// Checks done in the browser before a request or message is sent. The server checks everything again.
import { CATEGORIES } from "./types";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 10_000;
export const MAX_CHAT_BODY = 2000;
export const FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.txt,.log,image/png,image/jpeg,image/webp,application/pdf,text/plain";
const ALLOWED_EXT = /\.(png|jpe?g|webp|pdf|txt|log)$/i;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,}$/;

export type FileErrorKey = "tooManyFiles" | "fileTooBig" | "fileType";
export type FormErrorKey =
  | "subjectRequired" | "subjectLong" | "bodyRequired" | "bodyLong" | "categoryRequired" | "nameRequired" | "emailInvalid" | FileErrorKey;

export interface TicketFields { category: string; subject: string; body: string; name?: string; email?: string }

/** Problems with the request form, by field. An empty object means it can be sent. `visitor` also needs a name and an e-mail. */
export function validateTicket(f: TicketFields, visitor = false): Partial<Record<"category" | "subject" | "body" | "name" | "email", FormErrorKey>> {
  const e: Partial<Record<"category" | "subject" | "body" | "name" | "email", FormErrorKey>> = {};
  if (!(CATEGORIES as readonly string[]).includes(f.category)) e.category = "categoryRequired";
  const subject = f.subject.trim();
  if (!subject) e.subject = "subjectRequired";
  else if (subject.length > MAX_SUBJECT) e.subject = "subjectLong";
  const body = f.body.trim();
  if (!body) e.body = "bodyRequired";
  else if (body.length > MAX_BODY) e.body = "bodyLong";
  if (visitor) {
    if (!(f.name ?? "").trim()) e.name = "nameRequired";
    if (!EMAIL.test((f.email ?? "").trim())) e.email = "emailInvalid";
  }
  return e;
}

/** The first problem with a set of files, or null when all are fine to send. */
export function checkFiles(files: { name: string; size: number }[], already = 0): FileErrorKey | null {
  if (files.length + already > MAX_FILES) return "tooManyFiles";
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) return "fileTooBig";
    if (!ALLOWED_EXT.test(f.name)) return "fileType";
  }
  return null;
}

/** Whether a chat message may be sent: something is written, and not too much. */
export function chatBodyOk(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= MAX_CHAT_BODY;
}

export function validEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}
