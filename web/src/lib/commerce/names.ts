// The words for order, payment and booking states, as message keys (chosen at run time, so each is wrapped in tk).
import { tk, type MessageKey } from "../i18n";
import type { BookingStatus, OrderStatus, PaymentMethod, PaymentStatus } from "../api-commerce";

export const ORDER_STATUS_NAME: Record<OrderStatus, MessageKey> = {
  new: tk("commerce.stNew"), confirmed: tk("commerce.stConfirmed"), ready: tk("commerce.stReady"), delivered: tk("commerce.stDelivered"), cancelled: tk("commerce.stCancelled"),
};

export const PAYMENT_NAME: Record<PaymentStatus, MessageKey> = {
  unpaid: tk("commerce.payUnpaid"), paid: tk("commerce.payPaid"), refunded: tk("commerce.payRefunded"),
};

export const METHOD_NAME: Record<PaymentMethod, MessageKey> = {
  cod: tk("commerce.payCod"), whatsapp: tk("commerce.payWhatsapp"), card_later: tk("commerce.payCard"),
};

export const BOOKING_STATUS_NAME: Record<BookingStatus, MessageKey> = {
  requested: tk("commerce.bkRequested"), confirmed: tk("commerce.bkConfirmed"), done: tk("commerce.bkDone"), cancelled: tk("commerce.bkCancelled"),
};
