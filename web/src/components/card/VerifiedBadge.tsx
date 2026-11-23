// The "Verified company" badge: a small check mark and a short label, with the proven e-mail domain as its tooltip.
// Pure markup (no hooks), so the server-drawn directory and the card page both use it; the texts are passed in.
export function VerifiedBadge({ domain, label, tip, align = "center" }: { domain: string; label: string; tip: string; align?: "center" | "start" }) {
  return (
    <p
      title={tip}
      aria-label={tip}
      data-verified-domain={domain}
      style={{
        display: "flex", alignItems: "center", justifyContent: align === "center" ? "center" : "flex-start", gap: 6,
        margin: 0, padding: "0 16px 8px", fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "var(--pgfg, var(--d-fg, currentColor))", opacity: 0.85,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
        <circle cx="12" cy="12" r="10" fill="#3B82F6" />
        <path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </p>
  );
}
