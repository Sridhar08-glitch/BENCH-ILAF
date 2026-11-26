// The Share hub: one page group (/app/share) for everything that puts a card into people's hands, and the old addresses that lead to it.
import { tk, type MessageKey } from "@/lib/i18n";

export type ShareTabId = "qr" | "nfc" | "signature" | "wallet" | "event";

export interface ShareTab {
  id: ShareTabId;
  href: string;
  label: MessageKey;
  icon: string;
}

const TABS: ShareTab[] = [
  { id: "qr", href: "/app/share", label: tk("tools.shareTabQr"), icon: "qr" },
  { id: "nfc", href: "/app/share/nfc", label: tk("tools.shareTabNfc"), icon: "nfc" },
  { id: "signature", href: "/app/share/signature", label: tk("tools.shareTabSignature"), icon: "mail" },
  { id: "wallet", href: "/app/share/wallet", label: tk("tools.shareTabWallet"), icon: "card" },
  { id: "event", href: "/app/share/event", label: tk("tools.shareTabEvent"), icon: "pin" },
];

/** The sections to show: the wallet pass only where it is offered (the product team can switch it off). */
export function shareTabs(opts: { wallet: boolean }): ShareTab[] {
  return TABS.filter((t) => t.id !== "wallet" || opts.wallet);
}

/** Which section a path belongs to. The hub's own address is the QR section. */
export function activeShareTab(pathname: string): ShareTabId {
  const found = TABS.filter((t) => t.id !== "qr").find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
  return found ? found.id : "qr";
}

export { LEGACY_ROUTES } from "./legacy-routes";
