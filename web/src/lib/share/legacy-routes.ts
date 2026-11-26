// The old addresses of the tools that now live under Share (and the paper-card scanner, now inside Contacts).
// No imports on purpose: next.config.ts reads this file.
export const LEGACY_ROUTES: { source: string; destination: string }[] = [
  { source: "/app/qr", destination: "/app/share" },
  { source: "/app/nfc", destination: "/app/share/nfc" },
  { source: "/app/signature", destination: "/app/share/signature" },
  { source: "/app/event", destination: "/app/share/event" },
  { source: "/app/scan", destination: "/app/contacts/scan" },
];
