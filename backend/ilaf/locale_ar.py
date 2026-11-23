"""Arabic texts (Modern Standard Arabic, written for business users in the Gulf).

Keys are the exact English wording used in the code. Values keep the same {placeholders}. Product and company
names, QR, vCard, CSV, Google, Wallet and similar terms stay in Latin script where Arabic business users expect
them. A text that is not listed here is sent in English.
"""
import re

MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]

# ---------------------------------------------------------------- phrases that depend on a count
# Keyed by the English singular wording. Forms: zero, one, two, few, many, other.
PLURALS = {
    "{n} lead was assigned to you": {
        "one": "تم إسناد عميل محتمل واحد إليك",
        "two": "تم إسناد عميلين محتملين إليك",
        "few": "تم إسناد {n} عملاء محتملين إليك",
        "many": "تم إسناد {n} عميلًا محتملًا إليك",
        "other": "تم إسناد {n} عميل محتمل إليك",
    },
    "{by} gave you {n} lead.": {
        "one": "أسند إليك {by} عميلًا محتملًا واحدًا.",
        "two": "أسند إليك {by} عميلين محتملين.",
        "few": "أسند إليك {by} {n} عملاء محتملين.",
        "many": "أسند إليك {by} {n} عميلًا محتملًا.",
        "other": "أسند إليك {by} {n} عميل محتمل.",
    },
    "{n} click": {
        "zero": "لا نقرات",
        "one": "نقرة واحدة",
        "two": "نقرتان",
        "few": "{n} نقرات",
        "many": "{n} نقرة",
        "other": "{n} نقرة",
    },
    "Assign {n} open lead": {
        "one": "إسناد عميل محتمل مفتوح واحد",
        "two": "إسناد عميلين محتملين مفتوحين",
        "few": "إسناد {n} عملاء محتملين مفتوحين",
        "many": "إسناد {n} عميلًا محتملًا مفتوحًا",
        "other": "إسناد {n} عميل محتمل مفتوح",
    },
    "Review {n} change": {
        "one": "مراجعة تعديل واحد",
        "two": "مراجعة تعديلين",
        "few": "مراجعة {n} تعديلات",
        "many": "مراجعة {n} تعديلًا",
        "other": "مراجعة {n} تعديل",
    },
    "Hi {name}, here is how your card was used ({span}).": {
        "one": "مرحبًا {name}، إليك ملخص استخدام بطاقتك ({span}).",
        "two": "مرحبًا {name}، إليك ملخص استخدام بطاقتيك ({span}).",
        "few": "مرحبًا {name}، إليك ملخص استخدام بطاقاتك ({span}).",
        "many": "مرحبًا {name}، إليك ملخص استخدام بطاقاتك ({span}).",
        "other": "مرحبًا {name}، إليك ملخص استخدام بطاقاتك ({span}).",
    },
}

TEXTS = {
    # ------------------------------------------------------------ e-mail frame
    "{product} by": "{product} من",
    ", ": "، ",
    # ------------------------------------------------------------ invite and sign-in e-mails
    "You are invited to join {workspace} on {product}": "تمت دعوتك للانضمام إلى {workspace} على {product}",
    "Join {workspace}": "انضم إلى {workspace}",
    "{workspace} has invited you to create your digital business card on {product}.":
        "دعتك {workspace} إلى إنشاء بطاقة أعمالك الرقمية على {product}.",
    "Your card is already started with your company's details. Accept the invite to finish it.":
        "بطاقتك جاهزة مسبقًا ببيانات شركتك. اقبل الدعوة لإكمالها.",
    "Accept invite": "قبول الدعوة",
    "Reset your {product} password": "إعادة تعيين كلمة مرور {product}",
    "Reset your password": "إعادة تعيين كلمة المرور",
    "We received a request to reset your password. This link works for {hours} hours.":
        "تلقينا طلبًا لإعادة تعيين كلمة المرور. هذا الرابط صالح لمدة {hours} ساعة.",
    "If you did not ask for this, you can ignore this email.": "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.",
    "Choose a new password": "اختيار كلمة مرور جديدة",
    # ------------------------------------------------------------ lead e-mails
    "Meeting request from {name}": "طلب اجتماع من {name}",
    "{name} would like to meet": "{name} يرغب في الاجتماع بك",
    "{name} shared their details with you": "{name} شارك بياناته معك",
    "{name} shared their details": "{name} شارك بياناته",
    "Card: {card}": "البطاقة: {card}",
    "Your card": "بطاقتك",
    "Name: {name}": "الاسم: {name}",
    "Email: {value}": "البريد الإلكتروني: {value}",
    "Phone: {value}": "الهاتف: {value}",
    "Company: {value}": "الشركة: {value}",
    "Preferred times: {value}": "الأوقات المفضلة: {value}",
    "Message: {value}": "الرسالة: {value}",
    "Open your contacts": "فتح جهات الاتصال",
    "A colleague": "أحد الزملاء",
    "{by} gave you a lead.": "أسند إليك {by} عميلًا محتملًا.",
    "A lead was assigned to you: {name}": "تم إسناد عميل محتمل إليك: {name}",
    "A lead was assigned to you": "تم إسناد عميل محتمل إليك",
    # ------------------------------------------------------------ webhooks
    "A webhook was switched off": "تم إيقاف Webhook",
    "We could not reach {url} for {count} sends in a row, so it was switched off to protect your company's data from being retried forever.":
        "تعذّر الوصول إلى {url} في {count} عمليات إرسال متتالية، لذلك تم إيقافه حتى لا تُعاد محاولة إرسال بيانات شركتك إلى ما لا نهاية.",
    "Fix the receiver, then switch the webhook back on in Settings > Integrations.":
        "أصلح الجهة المستقبِلة، ثم أعد تشغيل Webhook من الإعدادات > التكاملات.",
    "Open Integrations": "فتح التكاملات",
    # ------------------------------------------------------------ change approvals
    "the name": "الاسم",
    "the job title": "المسمى الوظيفي",
    "the photo": "الصورة",
    "the company line": "سطر الشركة",
    "the address": "العنوان",
    "the buttons": "الأزرار",
    "{who} asked for a change on {workspace}": "{who} طلب تعديلًا في {workspace}",
    "A change is waiting for your approval": "يوجد تعديل بانتظار موافقتك",
    "{who} wants to change {what} on their card. The card keeps its current details until you decide.":
        "يرغب {who} في تعديل {what} في بطاقته. تحتفظ البطاقة ببياناتها الحالية إلى أن تتخذ قرارك.",
    "Review the change": "مراجعة التعديل",
    "Your change was approved": "تمت الموافقة على تعديلك",
    "Your change to {what} on your card was approved and is now live.":
        "تمت الموافقة على تعديل {what} في بطاقتك وأصبح ظاهرًا الآن.",
    "Your change was not approved": "لم تتم الموافقة على تعديلك",
    "Your change to {what} on your card was not approved. Your card still shows the earlier details.":
        "لم تتم الموافقة على تعديل {what} في بطاقتك. ما زالت بطاقتك تعرض البيانات السابقة.",
    "Reason from your admin: {reason}": "السبب من المسؤول: {reason}",
    "Open my card": "فتح بطاقتي",
    # ------------------------------------------------------------ data export and deletion
    "Hi {name},": "مرحبًا {name}،",
    "Hello,": "مرحبًا،",
    "The download of {workspace} company data is ready. The link works once and expires in {hours} hours.":
        "تنزيل بيانات شركة {workspace} جاهز. يعمل الرابط مرة واحدة فقط وتنتهي صلاحيته بعد {hours} ساعة.",
    "The download of your data is ready. The link works once and expires in {hours} hours.":
        "تنزيل بياناتك جاهز. يعمل الرابط مرة واحدة فقط وتنتهي صلاحيته بعد {hours} ساعة.",
    "Your {product} data export is ready": "تصدير بياناتك من {product} جاهز",
    "Your data export is ready": "تصدير بياناتك جاهز",
    "If you did not ask for this, ignore this email and change your password.":
        "إذا لم تطلب ذلك، تجاهل هذه الرسالة وغيّر كلمة المرور.",
    "Download my data": "تنزيل بياناتي",
    "Your {product} account is scheduled for deletion": "حسابك على {product} مجدول للحذف",
    "Your account will be deleted": "سيتم حذف حسابك",
    "We received your request to delete your account. It is switched off now, and all data will be erased permanently on {date}.":
        "تلقينا طلبك بحذف حسابك. تم إيقافه الآن، وسيتم محو جميع البيانات نهائيًا بتاريخ {date}.",
    "Changed your mind? You can restore your account until then.": "غيّرت رأيك؟ يمكنك استعادة حسابك حتى ذلك الحين.",
    "If you did not ask for this, restore it now and change your password.":
        "إذا لم تطلب ذلك، فاستعد الحساب الآن وغيّر كلمة المرور.",
    "Restore my account": "استعادة حسابي",
    "Your {product} company {company} is scheduled for deletion": "شركتك {company} على {product} مجدولة للحذف",
    "Your company {company} will be deleted": "سيتم حذف شركتك {company}",
    "We received your request to delete your company {company}. It is switched off now, and all data will be erased permanently on {date}.":
        "تلقينا طلبك بحذف شركتك {company}. تم إيقافها الآن، وسيتم محو جميع البيانات نهائيًا بتاريخ {date}.",
    "Changed your mind? You can restore your company {company} until then.":
        "غيّرت رأيك؟ يمكنك استعادة شركتك {company} حتى ذلك الحين.",
    "Restore my company {company}": "استعادة شركتي {company}",
    "Your {product} account is back": "عاد حسابك على {product}",
    "Your account is restored": "تمت استعادة حسابك",
    "Your account was restored and your cards are live again. Welcome back.":
        "تمت استعادة حسابك وأصبحت بطاقاتك متاحة من جديد. أهلًا بعودتك.",
    "Sign in": "تسجيل الدخول",
    "{workspace} is scheduled for deletion": "{workspace} مجدولة للحذف",
    "Your company is closing": "شركتك قيد الإغلاق",
    "The owner of {workspace} asked to delete the company. Its cards are offline now and all company data will be erased on {date}.":
        "طلب مالك {workspace} حذف الشركة. بطاقاتها متوقفة الآن وسيتم محو جميع بيانات الشركة بتاريخ {date}.",
    "Please contact the owner if this is a surprise.": "يُرجى التواصل مع المالك إذا كان هذا الأمر مفاجئًا لك.",
    "{workspace} was restored": "تمت استعادة {workspace}",
    "Your company is restored": "تمت استعادة شركتك",
    "{workspace} was restored. Its cards are live again.": "تمت استعادة {workspace} وأصبحت بطاقاتها متاحة من جديد.",
    "Open the dashboard": "فتح لوحة التحكم",
    "Your {product} account was deleted": "تم حذف حسابك على {product}",
    "Your account is deleted": "تم حذف حسابك",
    "As you asked, your account and its data have been erased permanently. Thank you for having used our service.":
        "بناءً على طلبك، تم محو حسابك وبياناته نهائيًا. شكرًا لاستخدامك خدمتنا.",
    "Your {product} company was deleted": "تم حذف شركتك على {product}",
    "Your company is deleted": "تم حذف شركتك",
    "As you asked, the company and its data have been erased permanently.":
        "بناءً على طلبك، تم محو الشركة وبياناتها نهائيًا.",
    # ------------------------------------------------------------ weekly report
    "no change": "بلا تغيير",
    "up {pct}%": "ارتفاع {pct}%",
    "down {pct}%": "انخفاض {pct}%",
    "Views": "المشاهدات",
    "QR scans": "مسح رمز QR",
    "Contacts saved": "جهات الاتصال المحفوظة",
    "Button clicks": "نقرات الأزرار",
    "New leads": "عملاء محتملون جدد",
    "Leads won": "صفقات تم كسبها",
    "weekly report for your company": "التقرير الأسبوعي لشركتك",
    "weekly report of your own cards": "التقرير الأسبوعي لبطاقاتك",
    "Unsubscribe in one click": "إلغاء الاشتراك بنقرة واحدة",
    "or": "أو",
    "change your report settings": "غيّر إعدادات التقرير",
    "You get this because the {what} is on.": "وصلتك هذه الرسالة لأن {what} مفعّل.",
    "no earlier data": "لا توجد بيانات سابقة",
    "there": "بك",
    "Views: {value} ({change})": "المشاهدات: {value} ({change})",
    "QR scans: {value}": "مسح رمز QR: {value}",
    "Contacts saved: {value}": "جهات الاتصال المحفوظة: {value}",
    "Button clicks: {value}": "نقرات الأزرار: {value}",
    "New leads: {value}": "عملاء محتملون جدد: {value}",
    "Your most used button": "الزر الأكثر استخدامًا",
    "Most used button: {kind} ({clicks})": "الزر الأكثر استخدامًا: {kind} ({clicks})",
    "Open your analytics": "فتح التحليلات",
    "Unsubscribe": "إلغاء الاشتراك",
    "Report settings": "إعدادات التقرير",
    "Your week": "أسبوعك",
    "Your week: {views} views, {leads} new leads ({span})": "أسبوعك: {views} مشاهدة، {leads} عميل محتمل جديد ({span})",
    "{company}: how your team's cards did ({span}).": "{company}: أداء بطاقات فريقك ({span}).",
    "Top people": "الأكثر نشاطًا",
    "{views} views, {leads} leads": "{views} مشاهدة، {leads} عميل محتمل",
    "New": "جديد",
    "Contacted": "تم التواصل",
    "Qualified": "مؤهَّل",
    "Won": "تم كسبه",
    "Lost": "خسرناه",
    "Leads by status": "العملاء المحتملون حسب الحالة",
    "Leads by status: {list}": "العملاء المحتملون حسب الحالة: {list}",
    "Open leads nobody owns yet: {value}": "عملاء محتملون مفتوحون بلا مسؤول: {value}",
    "Changes waiting for approval: {value}": "تعديلات بانتظار الموافقة: {value}",
    "Needs you": "بانتظار إجرائك",
    "Open analytics": "فتح التحليلات",
    "{company} this week": "{company} هذا الأسبوع",
    "{company}: {views} views, {leads} new leads ({span})": "{company}: {views} مشاهدة، {leads} عميل محتمل جديد ({span})",
    # ------------------------------------------------------------ API messages
    "Invalid input.": "مدخلات غير صالحة.",
    "Please check the highlighted fields.": "يُرجى مراجعة الحقول المحددة.",
    "Not found.": "غير موجود.",
    "Each entry must be an object.": "يجب أن يكون كل إدخال كائناً.",
    "Use lower-case letters, digits, '_', '.', ':' or '-' (up to 64).": "استخدم أحرفاً لاتينية صغيرة وأرقاماً وأحد الرموز _ . : - فقط (حتى 64 حرفاً).",
    "Choose a valid state.": "اختر حالة صالحة.",
    "Send between 1 and 20 entries.": "أرسل ما بين إدخال واحد و20 إدخالاً.",
    "Too many saved guide entries.": "عدد إدخالات الدليل المحفوظة كبير جداً.",
    "Card not found.": "البطاقة غير موجودة.",
    "Method not allowed.": "الطريقة غير مسموح بها.",
    "Something went wrong on our side.": "حدث خطأ من جانبنا.",
    "You do not have permission to do that.": "ليست لديك صلاحية لتنفيذ ذلك.",
    "Please sign in to continue.": "يُرجى تسجيل الدخول للمتابعة.",
    "Your session has expired. Please sign in again.": "انتهت جلستك. يُرجى تسجيل الدخول من جديد.",
    "Too many requests. Please wait a moment and try again.": "طلبات كثيرة. يُرجى الانتظار قليلًا ثم المحاولة من جديد.",
    "You have sent several messages already. Please try again later.": "أرسلت عدة رسائل بالفعل. يُرجى المحاولة لاحقًا.",
    "Email or password is not correct.": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "An account with this email already exists.": "يوجد حساب بهذا البريد الإلكتروني بالفعل.",
    "Enter your name.": "أدخل اسمك.",
    "Enter your email address.": "أدخل بريدك الإلكتروني.",
    "Enter a valid email address.": "أدخل بريدًا إلكترونيًا صالحًا.",
    "Invalid email address.": "بريد إلكتروني غير صالح.",
    "Choose a password.": "اختر كلمة مرور.",
    "Choose one of the available languages.": "اختر إحدى اللغات المتاحة.",
    "Your current password is not correct.": "كلمة المرور الحالية غير صحيحة.",
    "That password is not correct.": "كلمة المرور غير صحيحة.",
    "Enter your password to confirm.": "أدخل كلمة المرور للتأكيد.",
    "This reset link is invalid or has expired.": "رابط إعادة التعيين غير صالح أو انتهت صلاحيته.",
    "This restore link is not valid or has expired.": "رابط الاستعادة غير صالح أو انتهت صلاحيته.",
    "This invite link is no longer valid.": "رابط الدعوة لم يعد صالحًا.",
    "This invite was sent a moment ago.": "أُرسلت هذه الدعوة قبل لحظات.",
    "This account has been disabled. Please contact support.": "تم تعطيل هذا الحساب. يُرجى التواصل مع الدعم.",
    "This account is scheduled for deletion. You can restore it until the grace period ends.":
        "هذا الحساب مجدول للحذف. يمكنك استعادته حتى انتهاء فترة السماح.",
    "This account can no longer be restored.": "لم يعد بالإمكان استعادة هذا الحساب.",
    "This company can no longer be restored.": "لم يعد بالإمكان استعادة هذه الشركة.",
    "This company is already scheduled for deletion.": "هذه الشركة مجدولة للحذف بالفعل.",
    "Type the company name exactly to confirm.": "اكتب اسم الشركة كما هو تمامًا للتأكيد.",
    "This download link has expired. Ask for a new export in Settings.": "انتهت صلاحية رابط التنزيل. اطلب تصديرًا جديدًا من الإعدادات.",
    "This link was already used. Ask for a new export in Settings.": "سبق استخدام هذا الرابط. اطلب تصديرًا جديدًا من الإعدادات.",
    "This export file is no longer available. Please ask for a new one.": "ملف التصدير لم يعد متاحًا. يُرجى طلب ملف جديد.",
    "This export is not ready to download.": "التصدير غير جاهز للتنزيل بعد.",
    "Your company requires you to sign in with Google. Use the Continue with Google button.":
        "تشترط شركتك تسجيل الدخول عبر Google. استخدم زر المتابعة مع Google.",
    "This company requires Google sign-in. Use the Continue with Google button.":
        "تشترط هذه الشركة تسجيل الدخول عبر Google. استخدم زر المتابعة مع Google.",
    "Your email domain is not allowed to join this company.": "نطاق بريدك الإلكتروني غير مسموح له بالانضمام إلى هذه الشركة.",
    "This email domain is not allowed in your company settings.": "نطاق البريد الإلكتروني هذا غير مسموح به في إعدادات شركتك.",
    "Google sign-in is not reachable right now. Please try again.": "تعذّر الوصول إلى تسجيل الدخول عبر Google حاليًا. حاول مرة أخرى.",
    "This Google sign-in has expired. Please try again.": "انتهت صلاحية تسجيل الدخول عبر Google. حاول مرة أخرى.",
    "Sign in with Google is not set up on this server.": "تسجيل الدخول عبر Google غير مفعّل على هذا الخادم.",
    "A different Google account is already linked to this account.": "يوجد حساب Google آخر مرتبط بهذا الحساب بالفعل.",
    "That Google account is already linked to another account.": "حساب Google هذا مرتبط بحساب آخر بالفعل.",
    "No Google account is linked.": "لا يوجد حساب Google مرتبط.",
    "Set a password first, so you can still sign in after Google is removed.":
        "عيّن كلمة مرور أولًا لتتمكن من تسجيل الدخول بعد إزالة Google.",
    "Your Google account has no verified email address, so it cannot be used here.":
        "حساب Google الخاص بك لا يحتوي على بريد إلكتروني موثّق، لذا لا يمكن استخدامه هنا.",
    "An active plan is required to create cards.": "يلزم وجود اشتراك فعّال لإنشاء البطاقات.",
    "An active plan is required to publish.": "يلزم وجود اشتراك فعّال للنشر.",
    "An active plan is required to invite people.": "يلزم وجود اشتراك فعّال لدعوة الأشخاص.",
    "An active plan is required to add this card to Google Wallet.": "يلزم وجود اشتراك فعّال لإضافة هذه البطاقة إلى Google Wallet.",
    "Publish the card first, then add it to Google Wallet.": "انشر البطاقة أولًا ثم أضفها إلى Google Wallet.",
    "Each team member can have one card.": "يمكن لكل عضو في الفريق امتلاك بطاقة واحدة.",
    "Add a name before publishing.": "أضف اسمًا قبل النشر.",
    "Enter a name for the card.": "أدخل اسمًا للبطاقة.",
    "Enter a name.": "أدخل الاسم.",
    "Enter a company name.": "أدخل اسم الشركة.",
    "Enter a department name.": "أدخل اسم القسم.",
    "You already have a department with this name.": "لديك قسم بهذا الاسم بالفعل.",
    "Department not found.": "القسم غير موجود.",
    "This address is already taken.": "هذا العنوان مستخدم بالفعل.",
    "This address is reserved.": "هذا العنوان محجوز.",
    "Use 3 to 40 letters, numbers or dashes, starting and ending with a letter or number.":
        "استخدم من 3 إلى 40 حرفًا أو رقمًا أو شرطة، على أن يبدأ وينتهي بحرف أو رقم.",
    "This card is already published.": "هذه البطاقة منشورة بالفعل.",
    "This card is not published.": "هذه البطاقة غير منشورة.",
    "This card is suspended.": "هذه البطاقة موقوفة.",
    "This card is suspended. Restore it first.": "هذه البطاقة موقوفة. استعدها أولًا.",
    "This card is already suspended.": "هذه البطاقة موقوفة بالفعل.",
    "This card is not suspended.": "هذه البطاقة غير موقوفة.",
    "This card is no longer active.": "هذه البطاقة لم تعد نشطة.",
    "This card is temporarily unavailable.": "هذه البطاقة غير متاحة مؤقتًا.",
    "This card does not take meeting requests.": "هذه البطاقة لا تستقبل طلبات الاجتماع.",
    "This card is not taking contact details.": "هذه البطاقة لا تستقبل بيانات التواصل.",
    "Only company cards can be suspended.": "يمكن إيقاف بطاقات الشركات فقط.",
    "Only company cards can be reassigned.": "يمكن إعادة إسناد بطاقات الشركات فقط.",
    "Not enough seats. Add seats to your plan to invite more people.": "المقاعد غير كافية. أضف مقاعد إلى اشتراكك لدعوة المزيد من الأشخاص.",
    "No seats left.": "لا توجد مقاعد متبقية.",
    "This person is already in the team.": "هذا الشخص موجود في الفريق بالفعل.",
    "This email appears twice.": "هذا البريد الإلكتروني مكرر.",
    "Only the owner can invite admins.": "المالك وحده يمكنه دعوة المسؤولين.",
    "Only the owner can change roles.": "المالك وحده يمكنه تغيير الأدوار.",
    "Only the owner can change an admin.": "المالك وحده يمكنه تعديل المسؤول.",
    "The owner cannot be changed or removed.": "لا يمكن تعديل المالك أو إزالته.",
    "You cannot remove yourself.": "لا يمكنك إزالة نفسك.",
    "You cannot suspend yourself.": "لا يمكنك إيقاف نفسك.",
    "Teams are only available on company workspaces.": "الفرق متاحة لمساحات عمل الشركات فقط.",
    "This is only available on company workspaces.": "هذا الخيار متاح لمساحات عمل الشركات فقط.",
    "The directory is only available on company workspaces.": "الدليل متاح لمساحات عمل الشركات فقط.",
    "Only the owner can change the company directory.": "المالك وحده يمكنه تعديل دليل الشركة.",
    "Only the owner can change the company sign-in rules.": "المالك وحده يمكنه تعديل قواعد تسجيل الدخول للشركة.",
    "Choose an address for the directory before switching it on.": "اختر عنوانًا للدليل قبل تفعيله.",
    "Only people who have not joined yet can be sent the invite again.": "لا يمكن إعادة إرسال الدعوة إلا لمن لم ينضم بعد.",
    "Choose a CSV file.": "اختر ملف CSV.",
    "The file is empty.": "الملف فارغ.",
    "The file must be under 1 MB.": "يجب أن يكون الملف أقل من 1 ميغابايت.",
    "Save the file as UTF-8 CSV.": "احفظ الملف بصيغة CSV بترميز UTF-8.",
    "The first row must have the columns email, full_name, title.": "يجب أن يحتوي الصف الأول على الأعمدة email وfull_name وtitle.",
    "Duplicate email in this file.": "بريد إلكتروني مكرر في هذا الملف.",
    "Already in the team.": "موجود في الفريق بالفعل.",
    "Enter a phone number such as +974 5555 5555.": "أدخل رقم هاتف مثل ⁦+974 5555 5555⁩.",
    "Enter a full web address.": "أدخل عنوان موقع إلكتروني كاملًا.",
    "Enter a web address starting with http or https.": "أدخل عنوان موقع يبدأ بـ http أو https.",
    "Enter a link.": "أدخل رابطًا.",
    "Enter a link, an email address or a phone number.": "أدخل رابطًا أو بريدًا إلكترونيًا أو رقم هاتف.",
    "Enter an address.": "أدخل عنوانًا.",
    "Enter an email address or a phone number.": "أدخل بريدًا إلكترونيًا أو رقم هاتف.",
    "Enter the link or number for each button.": "أدخل الرابط أو الرقم لكل زر.",
    "Each button must have a kind and a value.": "يجب أن يحتوي كل زر على نوع وقيمة.",
    "Choose a button kind from the list.": "اختر نوع الزر من القائمة.",
    "This kind of link is not allowed.": "هذا النوع من الروابط غير مسموح به.",
    "This kind of link is not allowed. Use http, https, tel, mailto or sms style links.":
        "هذا النوع من الروابط غير مسموح به. استخدم روابط من نوع http أو https أو tel أو mailto أو sms.",
    "A meeting link must start with https://.": "يجب أن يبدأ رابط الاجتماع بـ https://.",
    "Remove the user name and password from the address.": "أزل اسم المستخدم وكلمة المرور من العنوان.",
    "That address is too long.": "هذا العنوان طويل جدًا.",
    "That address could not be found.": "تعذّر العثور على هذا العنوان.",
    "Use a PNG, JPG or WebP image.": "استخدم صورة بصيغة PNG أو JPG أو WebP.",
    "Choose an image file.": "اختر ملف صورة.",
    "That file is not a valid image.": "هذا الملف ليس صورة صالحة.",
    "That image is too large. Use one under 40 megapixels.": "هذه الصورة كبيرة جدًا. استخدم صورة أقل من 40 ميغابكسل.",
    "Animated images are not accepted. Use a still PNG, JPG or WebP image.":
        "الصور المتحركة غير مقبولة. استخدم صورة ثابتة بصيغة PNG أو JPG أو WebP.",
    "SVG files are not accepted. Use a PNG, JPG or WebP image.": "ملفات SVG غير مقبولة. استخدم صورة بصيغة PNG أو JPG أو WebP.",
    "Keep this under {max_len} characters.": "اجعل النص أقل من {max_len} حرفًا.",
    "Control characters are not allowed.": "رموز التحكم غير مسموح بها.",
    "Name or title is too long or has invalid characters.": "الاسم أو المسمى طويل جدًا أو يحتوي على رموز غير صالحة.",
    "Use up to 80 characters.": "استخدم 80 حرفًا كحد أقصى.",
    "Use a colour like #1a2b3c.": "استخدم لونًا مثل ⁦#1a2b3c⁩.",
    "Use auto or a colour like #1a2b3c.": "استخدم auto أو لونًا مثل ⁦#1a2b3c⁩.",
    "Company colours are only available when your company has set its brand colours.":
        "ألوان الشركة متاحة فقط بعد أن تحدد شركتك ألوان هويتها.",
    "Upload your {noun} first.": "ارفع {noun} أولًا.",
    "Choose one of the sample pictures.": "اختر إحدى الصور النموذجية.",
    "Company branding is only available on company workspaces.": "هوية الشركة متاحة لمساحات عمل الشركات فقط.",
    "Enter a domain name such as cards.example.com.": "أدخل اسم نطاق مثل cards.example.com.",
    "This domain is already in use.": "هذا النطاق مستخدم بالفعل.",
    "Your company has set the photo. Ask an admin if it needs to change.": "حددت شركتك الصورة. اطلب من المسؤول إن احتجت إلى تغييرها.",
    "Your company has set the buttons on cards. Ask an admin if they need to change.":
        "حددت شركتك أزرار البطاقات. اطلب من المسؤول إن احتجت إلى تغييرها.",
    "Your new photo was sent to an admin. Your card keeps the current photo until it is approved.":
        "تم إرسال صورتك الجديدة إلى المسؤول. تحتفظ بطاقتك بالصورة الحالية إلى حين الموافقة عليها.",
    "This change has already been decided or withdrawn.": "تم البت في هذا التعديل أو سحبه بالفعل.",
    "Choose approve or reject.": "اختر الموافقة أو الرفض.",
    "A mandatory button points at a banned domain.": "هناك زر إلزامي يشير إلى نطاق محظور.",
    "Choose at least one item.": "اختر عنصرًا واحدًا على الأقل.",
    "Pick at least one contact.": "اختر جهة اتصال واحدة على الأقل.",
    "Choose someone else to receive the card.": "اختر شخصًا آخر لاستلام البطاقة.",
    "Choose a person from the list.": "اختر شخصًا من القائمة.",
    "That person is not in this company.": "هذا الشخص ليس في هذه الشركة.",
    "Only an owner or admin can assign leads.": "المالك أو المسؤول فقط يمكنه إسناد العملاء المحتملين.",
    "Leads can only be assigned inside a company.": "لا يمكن إسناد العملاء المحتملين إلا داخل شركة.",
    "Write the note.": "اكتب الملاحظة.",
    "Please take a moment to fill in the form and try again.": "يُرجى ملء النموذج بتأنٍ ثم المحاولة من جديد.",
    "Please tick the box to agree.": "يُرجى تحديد خانة الموافقة.",
    "Add at least one time that suits you.": "أضف وقتًا واحدًا على الأقل يناسبك.",
    "Ask for an email address or a phone number, so you can reach the visitor.": "اطلب بريدًا إلكترونيًا أو رقم هاتف لتتمكن من التواصل مع الزائر.",
    "Enter the web address of your booking page.": "أدخل عنوان صفحة الحجز الخاصة بك.",
    "Enter the web address of your privacy page, such as https://example.com/privacy.":
        "أدخل عنوان صفحة الخصوصية الخاصة بك، مثل https://example.com/privacy.",
    "Enter the web address that should receive the events.": "أدخل عنوان الموقع الذي سيستقبل الأحداث.",
    "Webhooks are for company workspaces.": "Webhooks متاحة لمساحات عمل الشركات فقط.",
    "The webhook is switched off.": "Webhook متوقف.",
    "Webhook is not configured.": "Webhook غير مُعدّ.",
    "The receiver did not answer within 5 seconds.": "لم تستجب الجهة المستقبِلة خلال 5 ثوانٍ.",
    "That address points to a private or internal network, which is not allowed.": "يشير هذا العنوان إلى شبكة خاصة أو داخلية وهذا غير مسموح.",
    "This is a test event.": "هذا حدث تجريبي.",
    "Choose a range of at most {MAX_DAYS} days.": "اختر نطاقًا لا يتجاوز {MAX_DAYS} يومًا.",
    "The start must not be after the end.": "يجب ألا يكون تاريخ البداية بعد تاريخ النهاية.",
    "Use the date format YYYY-MM-DD.": "استخدم صيغة التاريخ YYYY-MM-DD.",
    "Not a known time zone name.": "اسم المنطقة الزمنية غير معروف.",
    "Only an owner or admin can see the company report.": "المالك أو المسؤول فقط يمكنه الاطلاع على تقرير الشركة.",
    "Only an owner or admin can change the company report.": "المالك أو المسؤول فقط يمكنه تعديل تقرير الشركة.",
    "Payments are not configured yet.": "المدفوعات غير مُعدّة بعد.",
    "Unknown plan.": "اشتراك غير معروف.",
    "No plan exists for this workspace type.": "لا يوجد اشتراك مخصص لهذا النوع من مساحات العمل.",
    "Enter the password of your existing account.": "أدخل كلمة مرور حسابك الحالي.",
    "You have no card to attach this contact to.": "ليست لديك بطاقة لربط جهة الاتصال بها.",
    "This design setting does not exist.": "إعداد التصميم هذا غير موجود.",
    "Choose one of the available fonts, or \"face\" to keep the design's own fonts.": "اختر أحد الخطوط المتاحة، أو \"face\" للإبقاء على خطوط التصميم نفسه.",
    "This setting does not exist.": "هذا الإعداد غير موجود.",
    "Must be text.": "يجب أن يكون نصًا.",
    "Must be a number.": "يجب أن يكون رقمًا.",
    "Must be true or false.": "يجب أن يكون صحيحًا أو خطأ.",
    "Must be an object.": "يجب أن يكون كائنًا.",
    "Not found in this company.": "غير موجود في هذه الشركة.",
}

# Messages that carry a value: matched as a whole and filled from the named groups.
PATTERNS = [
    (re.compile(r"A card can have at most (?P<n>\d+) items\."), "يمكن أن تحتوي البطاقة على {n} عنصرًا كحد أقصى."),
    (re.compile(r"Your plan allows (?P<n>\d+) card\(s\)\. Upgrade to add more\."),
     "يسمح اشتراكك بعدد {n} من البطاقات. قم بالترقية لإضافة المزيد."),
    (re.compile(r"Keep this under (?P<n>\d+) characters\."), "اجعل النص أقل من {n} حرفًا."),
    (re.compile(r"Choose at most (?P<n>\d+) items at a time\."), "اختر {n} عنصرًا كحد أقصى في المرة الواحدة."),
    (re.compile(r"Pick at most (?P<n>\d+) contacts at a time\."), "اختر {n} جهة اتصال كحد أقصى في المرة الواحدة."),
    (re.compile(r"This invite was sent a moment ago\. You can send it again in (?P<n>\d+) minutes?\."),
     "أُرسلت هذه الدعوة قبل لحظات. يمكنك إعادة إرسالها بعد {n} دقيقة."),
    (re.compile(r"You can ask for (?P<n>\d+) exports a day\. Please try again tomorrow\."),
     "يمكنك طلب {n} عمليات تصدير في اليوم. يُرجى المحاولة غدًا."),
    (re.compile(r"Type (?P<w>.+) to confirm\."), "اكتب {w} للتأكيد."),
    (re.compile(r"Links to (?P<d>.+) are not allowed on company cards\."), "الروابط إلى {d} غير مسموح بها في بطاقات الشركة."),
    (re.compile(r"Please fill in your (?P<f>.+)\."), "يُرجى تعبئة الحقل: {f}."),
    (re.compile(r"This invitation is for (?P<e>.+)\. Sign in with that Google account\."),
     "هذه الدعوة موجهة إلى {e}. سجّل الدخول بحساب Google هذا."),
    (re.compile(r"You already use (?P<n>\d+) seats\. Choose at least that many\."),
     "أنت تستخدم {n} مقعدًا بالفعل. اختر هذا العدد أو أكثر."),
    (re.compile(r"The (?P<l>.+) button is required by your company and cannot be removed or changed\."),
     "الزر {l} مطلوب من شركتك ولا يمكن إزالته أو تغييره."),
    (re.compile(r"Your company does not allow (?P<k>.+) buttons\."), "لا تسمح شركتك بأزرار {k}."),
    (re.compile(r"Your company has set (?P<f>.+)\. Ask an admin if it needs to change\."),
     "حددت شركتك {f}. اطلب من المسؤول إن احتجت إلى تغييره."),
    (re.compile(r"Choose a whole number from (?P<a>-?\d+) to (?P<b>-?\d+)\."), "اختر عددًا صحيحًا من {a} إلى {b}."),
    (re.compile(r"A department can set only the face, colour, layout below, opening, font and text size, not (?P<k>.+)\."),
     "يمكن للقسم ضبط الواجهة واللون والتخطيط أسفل البطاقة والافتتاح والخط وحجم النص فقط، وليس {k}."),
]


from .locale_ar_designs import PATTERNS as _DESIGN_PATTERNS, TEXTS as _DESIGN_TEXTS  # noqa: E402

TEXTS.update(_DESIGN_TEXTS)
PATTERNS.extend(_DESIGN_PATTERNS)

from .locale_ar_integrations import PATTERNS as _INTEGRATION_PATTERNS, TEXTS as _INTEGRATION_TEXTS  # noqa: E402

TEXTS.update(_INTEGRATION_TEXTS)
PATTERNS.extend(_INTEGRATION_PATTERNS)

from .locale_ar_errors import PATTERNS as _ERROR_PATTERNS, PLURALS as _ERROR_PLURALS, TEXTS as _ERROR_TEXTS  # noqa: E402

PLURALS.update(_ERROR_PLURALS)

for _key, _value in _ERROR_TEXTS.items():
    TEXTS.setdefault(_key, _value)
PATTERNS.extend(_ERROR_PATTERNS)

from .locale_ar_growth import PATTERNS as _GROWTH_PATTERNS, TEXTS as _GROWTH_TEXTS  # noqa: E402

TEXTS.update(_GROWTH_TEXTS)
PATTERNS.extend(_GROWTH_PATTERNS)

from .locale_ar_support import PATTERNS as _SUPPORT_PATTERNS, TEXTS as _SUPPORT_TEXTS  # noqa: E402

for _key, _value in _SUPPORT_TEXTS.items():
    TEXTS.setdefault(_key, _value)
PATTERNS.extend(_SUPPORT_PATTERNS)

from .locale_ar_admin import PATTERNS as _ADMIN_PATTERNS, TEXTS as _ADMIN_TEXTS  # noqa: E402

for _key, _value in _ADMIN_TEXTS.items():
    TEXTS.setdefault(_key, _value)
PATTERNS.extend(_ADMIN_PATTERNS)

from .locale_ar_company import PATTERNS as _COMPANY_PATTERNS, TEXTS as _COMPANY_TEXTS  # noqa: E402

for _key, _value in _COMPANY_TEXTS.items():
    TEXTS.setdefault(_key, _value)
PATTERNS.extend(_COMPANY_PATTERNS)
