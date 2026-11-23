import type { Messages } from "../messages";
import type { err as en } from "../en/err";

export const err: Messages<typeof en> = {
  "err.offline": "يبدو أنك غير متصل بالإنترنت. تحقق من اتصالك وحاول مرة أخرى.",
  "err.generic": "حدث خطأ ما. يُرجى المحاولة مرة أخرى.",
  "err.unreachable": "تعذّر الوصول إلى الخدمة حاليًا. يُرجى المحاولة مرة أخرى.",
  "err.sessionExpired": "انتهت جلستك. يُرجى تسجيل الدخول من جديد.",
  "err.throttled": "يُرجى الانتظار {n, plural, one {ثانية واحدة} two {ثانيتين} few {# ثوانٍ} many {# ثانية} other {# ثانية}} ثم المحاولة مرة أخرى.",
  "err.throttledNote": "عدد الطلبات كبير جدًا. يمكنك المحاولة مرة أخرى بعد {n, plural, one {ثانية واحدة} two {ثانيتين} few {# ثوانٍ} many {# ثانية} other {# ثانية}}.",
  "err.originRefused": "لم يصدر هذا الطلب من التطبيق. أعد تحميل الصفحة وحاول مرة أخرى.",
  "err.pendingDeletion": "هذه الشركة مغلقة لأنها مجدولة للحذف.",
};
