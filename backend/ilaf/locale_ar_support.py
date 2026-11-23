"""Arabic texts of the support system: e-mails (tickets, chat transcripts), the answers the API gives a customer and the
auto-replies. Merged into ilaf.locale_ar (TEXTS and PATTERNS). Staff-only messages stay in English by design, except
the ones a customer can also see."""
import re

TEXTS = {
    # ---------------------------------------------------------------- e-mails to the customer
    "We received your request": "استلمنا طلبك",
    "We received your request {ticket}.": "استلمنا طلبك {ticket}.",
    "Reply to this e-mail to add more details.": "يمكنك الرد على هذه الرسالة لإضافة المزيد من التفاصيل.",
    "Reply to this e-mail to answer.": "رد على هذه الرسالة للإجابة.",
    "Open your request": "فتح طلبك",
    "We replied to your request": "رددنا على طلبك",
    "{agent} from our team replied to your request {ticket}:": "ردّ {agent} من فريقنا على طلبك {ticket}:",
    "Our support team": "فريق الدعم لدينا",
    "Your request was marked as solved": "تم تحديد طلبك على أنه محلول",
    "We marked {ticket} as solved. If it is not, reply within {days} days and we will reopen it.":
        "حددنا {ticket} على أنه محلول. إن لم يكن كذلك فرد خلال {days} يومًا وسنعيد فتحه.",
    "Your request was closed": "تم إغلاق طلبك",
    "We closed {ticket}. Start a new request any time if you need more help.": "أغلقنا {ticket}. يمكنك بدء طلب جديد في أي وقت إن احتجت إلى مساعدة.",
    "Your chat transcript": "نص محادثتك",
    "Here is a copy of your chat with our team. It is saved with request {ticket}.": "هذه نسخة من محادثتك مع فريقنا. وهي محفوظة مع الطلب {ticket}.",
    "Our team would like to chat": "فريقنا يرغب في محادثتك",
    "{agent} is online now and would like to chat about {ticket}.": "{agent} متصل الآن ويرغب في محادثتك بخصوص {ticket}.",
    "Open the chat": "فتح المحادثة",
    "Support": "الدعم",
    "Visitor": "زائر",
    "Live chat": "محادثة مباشرة",
    # ---------------------------------------------------------------- e-mails to the team (sent in the person's language)
    "New support request": "طلب دعم جديد",
    "New support request: {subject}": "طلب دعم جديد: {subject}",
    "{ticket} from {name}: {subject}": "{ticket} من {name}: {subject}",
    "Open in the staff area": "فتح في منطقة الفريق",
    "New reply on: {subject}": "رد جديد على: {subject}",
    "The customer replied": "ردّ العميل",
    "{ticket} has a new reply.": "{ticket} عليه رد جديد.",
    "SLA missed: {subject}": "تجاوز المهلة: {subject}",
    "A support deadline was missed": "تم تجاوز مهلة دعم",
    "{ticket} missed its {which} deadline.": "تجاوز {ticket} مهلة {which}.",
    "first reply": "الرد الأول",
    "resolution": "الحل",
    # ---------------------------------------------------------------- answers the API gives
    "This message contains words we do not accept.": "تحتوي هذه الرسالة على كلمات لا نقبلها.",
    "You cannot contact support from here right now.": "لا يمكنك التواصل مع الدعم من هنا حاليًا.",
    "This request is closed. Please start a new request.": "هذا الطلب مغلق. يرجى بدء طلب جديد.",
    "This request was solved more than 14 days ago. Please start a new request.": "تم حل هذا الطلب قبل أكثر من 14 يومًا. يرجى بدء طلب جديد.",
    "You can rate a request once it is solved.": "يمكنك تقييم الطلب بعد حله.",
    "We could not check that you are a person. Please reload the page and try again.": "تعذّر التحقق من أنك شخص حقيقي. أعد تحميل الصفحة وحاول مرة أخرى.",
    "Live chat is not available right now. Please send us a message instead.": "المحادثة المباشرة غير متاحة الآن. يرجى إرسال رسالة لنا بدلًا من ذلك.",
    "You already have a chat open.": "لديك محادثة مفتوحة بالفعل.",
    "Nobody is online right now. Leave us a message and we will answer by e-mail.": "لا أحد متصل الآن. اترك لنا رسالة وسنرد عليك عبر البريد الإلكتروني.",
    "This chat has ended.": "انتهت هذه المحادثة.",
    "Another person already took this chat.": "قبل شخص آخر هذه المحادثة بالفعل.",
    "Choose a category.": "اختر فئة.",
    "Choose a rating from 1 to 5.": "اختر تقييمًا من 1 إلى 5.",
    "Write a message or attach a file.": "اكتب رسالة أو أرفق ملفًا.",
    "This field is required.": "هذا الحقل مطلوب.",
    "Use a PNG, JPG, WebP, PDF, TXT or LOG file.": "استخدم ملف PNG أو JPG أو WebP أو PDF أو TXT أو LOG.",
    "This file was refused because it may be unsafe.": "تم رفض هذا الملف لأنه قد يكون غير آمن.",
    # ---------------------------------------------------------------- staff-facing answers (kept for completeness)
    "The shared secret is wrong.": "السر المشترك غير صحيح.",
    "Only requests from the same person can be merged.": "يمكن دمج الطلبات من الشخص نفسه فقط.",
    "Only people with an account can be invited to a chat.": "يمكن دعوة أصحاب الحسابات فقط إلى المحادثة.",
    "This chat is with another person.": "هذه المحادثة مع شخص آخر.",
    "Choose a different request.": "اختر طلبًا آخر.",
    "Request not found.": "لم يتم العثور على الطلب.",
}

PATTERNS = [
    (re.compile(r"You can attach at most (?P<n>\d+) files to one message\."), "يمكنك إرفاق ما لا يزيد على {n} ملفات بالرسالة الواحدة."),
]
