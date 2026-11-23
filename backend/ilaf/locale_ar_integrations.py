"""Arabic texts of the API keys and CRM connector features (messages the settings pages and e-mails show).

Merged into the main Arabic catalogue by `locale_ar.py`. The public developer API keeps English-only machine messages;
the texts here are the ones that reach people in the web app and their inbox."""
import re

TEXTS = {
    # ---------------------------------------------------------------- API keys (Settings > Developers)
    "Give the key a name, for example the system that will use it.": "أعطِ المفتاح اسمًا، مثل اسم النظام الذي سيستخدمه.",
    "Choose at least one permission.": "اختر صلاحية واحدة على الأقل.",
    "Use a date and time such as 2027-01-31T00:00:00Z.": "استخدم تاريخًا ووقتًا مثل 2027-01-31T00:00:00Z.",
    "The expiry must be in the future.": "يجب أن يكون تاريخ الانتهاء في المستقبل.",
    "The expiry is too far away.": "تاريخ الانتهاء بعيد جدًا.",
    "Send a list of addresses.": "أرسل قائمة بالعناوين.",
    "API keys are for company workspaces.": "مفاتيح API متاحة لمساحات عمل الشركات فقط.",
    "API keys need an active company plan.": "تحتاج مفاتيح API إلى اشتراك شركة فعّال.",
    "This key is no longer active.": "هذا المفتاح لم يعد فعّالًا.",
    # ---------------------------------------------------------------- CRM connectors (Settings > Integrations)
    "CRM connectors are for company workspaces.": "موصّلات CRM متاحة لمساحات عمل الشركات فقط.",
    "This CRM is not set up on this server yet.": "لم يتم إعداد هذا النظام (CRM) على الخادم بعد.",
    "CRM connectors need an active company plan.": "تحتاج موصّلات CRM إلى اشتراك شركة فعّال.",
    "This CRM is already connected. Disconnect it first.": "هذا النظام (CRM) متصل بالفعل. افصله أولًا.",
    "Choose the region of your account.": "اختر منطقة حسابك.",
    "This CRM is not connected.": "هذا النظام (CRM) غير متصل.",
    "Connect this CRM again first.": "أعد ربط هذا النظام (CRM) أولًا.",
    "Use the CRM's field names: letters, digits and underscores, starting with a letter.":
        "استخدم أسماء حقول النظام: أحرف وأرقام وشرطات سفلية، وتبدأ بحرف.",
    "These sync settings are not valid.": "إعدادات المزامنة هذه غير صالحة.",
    "Send a mapping or settings to change.": "أرسل ربط الحقول أو الإعدادات المراد تغييرها.",
    # ---------------------------------------------------------------- e-mails to the admins
    "{crm} stopped syncing your contacts": "توقفت مزامنة جهات الاتصال مع {crm}",
    "{crm} no longer accepts the connection, so new contacts are not being sent. This usually means "
    "the connection was removed in {crm} or its permissions changed.":
        "لم يعد {crm} يقبل الاتصال، لذلك لا يتم إرسال جهات الاتصال الجديدة. يعني هذا غالبًا أن الاتصال أُزيل "
        "في {crm} أو أن صلاحياته تغيّرت.",
    "Connect it again in Settings > Integrations. Contacts that arrive meanwhile are kept and are "
    "sent after you reconnect.":
        "أعد ربطه من الإعدادات > التكاملات. جهات الاتصال التي تصل في الأثناء تُحفظ وتُرسل بعد إعادة الربط.",
    # ---------------------------------------------------------------- activity log wording
    "Created a card": "أنشأ بطاقة",
    "Changed a card": "عدّل بطاقة",
    "Made an API key": "أنشأ مفتاح API",
    "Revoked an API key": "ألغى مفتاح API",
    "Replaced an API key": "استبدل مفتاح API",
    "Connected a CRM": "ربط نظام CRM",
    "Disconnected a CRM": "فصل نظام CRM",
    "Changed the CRM sync settings": "غيّر إعدادات مزامنة CRM",
    "A CRM connection stopped working": "توقف اتصال نظام CRM عن العمل",
}

PATTERNS = [
    (re.compile(r"Unknown permission: (?P<p>.+)\."), "صلاحية غير معروفة: {p}."),
    (re.compile(r"Use at most (?P<n>\d+) addresses\."), "استخدم {n} عنوانًا كحد أقصى."),
    (re.compile(r"(?P<v>.+) is not an IP address or network\."), "{v} ليس عنوان IP أو شبكة."),
    (re.compile(r"A company can have up to (?P<n>\d+) active API keys\. Revoke one first\."),
     "يمكن للشركة امتلاك {n} مفتاح API فعّال كحد أقصى. ألغِ أحد المفاتيح أولًا."),
    (re.compile(r"Use a whole number from (?P<a>\d+) to (?P<b>\d+)\."), "استخدم عددًا صحيحًا من {a} إلى {b}."),
]
