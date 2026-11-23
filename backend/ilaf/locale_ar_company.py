"""Arabic texts for 2-step verification, signed-in devices, verified company domains, company e-mails, browser
notifications and the daily summary.

Merged into the main Arabic catalogue by `locale_ar.py`."""

TEXTS = {
    # ---- e-mails: new device and 2-step verification
    "an unknown device": "جهاز غير معروف",
    "New sign-in to your {product} account": "تسجيل دخول جديد إلى حسابك في {product}",
    "New sign-in from a new device": "تسجيل دخول جديد من جهاز جديد",
    "Your account was signed in to from {device} at {when}.": "تم تسجيل الدخول إلى حسابك من {device} في {when}.",
    "If this was you, you do not need to do anything. If it was not, change your password now and sign out all other devices in Settings.":
        "إن كنت أنت من فعل ذلك فلا تحتاج إلى أي إجراء. وإن لم تكن أنت، فغيّر كلمة المرور الآن وسجّل الخروج من جميع الأجهزة الأخرى من الإعدادات.",
    "Review your devices": "راجع أجهزتك",
    "2-step verification is on for your {product} account": "التحقق بخطوتين مفعّل لحسابك في {product}",
    "2-step verification turned on": "تم تفعيل التحقق بخطوتين",
    "2-step verification was turned on for your account. From now on you need a code from your authenticator app when you sign in.":
        "تم تفعيل التحقق بخطوتين لحسابك. من الآن ستحتاج إلى رمز من تطبيق المصادقة عند تسجيل الدخول.",
    "2-step verification is off for your {product} account": "التحقق بخطوتين متوقف لحسابك في {product}",
    "2-step verification turned off": "تم إيقاف التحقق بخطوتين",
    "2-step verification was turned off for your account.": "تم إيقاف التحقق بخطوتين لحسابك.",
    "If you did not do this, change your password now and contact support.": "إن لم تكن أنت من فعل ذلك، فغيّر كلمة المرور الآن وتواصل مع الدعم.",
    "Open security settings": "افتح إعدادات الأمان",
    "{company} requires 2-step verification": "{company} تشترط التحقق بخطوتين",
    "Turn on 2-step verification": "فعّل التحقق بخطوتين",
    "{company} now requires everyone to use 2-step verification.": "أصبحت {company} تشترط على الجميع استخدام التحقق بخطوتين.",
    "You have {days} days to turn it on. After that you can only reach the security settings until it is on.":
        "أمامك {days} أيام لتفعيله. بعد ذلك لن تتمكن من فتح سوى إعدادات الأمان إلى أن يتم تفعيله.",
    # ---- e-mails: verified domain
    "Confirm {domain} for {company}": "تأكيد {domain} لشركة {company}",
    "Confirm your company domain": "أكّد نطاق شركتك",
    "{company} asked to verify the domain {domain} on {product}.": "طلبت {company} توثيق النطاق {domain} على {product}.",
    "Your confirmation code is {code}. It works for {hours} hours.": "رمز التأكيد الخاص بك هو {code}. وهو صالح لمدة {hours} ساعة.",
    "If you did not expect this, ignore this e-mail and nothing changes.": "إن لم تكن تتوقع هذه الرسالة، فتجاهلها ولن يتغير شيء.",
    "Confirm the domain": "تأكيد النطاق",
    # ---- notifications and the daily summary
    "Notifications are on": "الإشعارات مفعّلة",
    "This is a test notification.": "هذا إشعار تجريبي.",
    "This link is not valid": "هذا الرابط غير صالح",
    "It may be incomplete. You can change your notification settings after you sign in.":
        "ربما يكون ناقصًا. يمكنك تغيير إعدادات الإشعارات بعد تسجيل الدخول.",
    "You are unsubscribed": "تم إلغاء اشتراكك",
    "You will not get the daily summary any more.": "لن يصلك الملخص اليومي بعد الآن.",
    "Your daily summary": "ملخصك اليومي",
    "Yesterday at a glance": "نظرة سريعة على أمس",
    "New leads": "عملاء محتملون جدد",
    "Card views": "مشاهدات البطاقة",
    "QR scans": "مسحات رمز QR",
    "Changes waiting for your approval": "تغييرات بانتظار موافقتك",
    "Support requests waiting for your reply: {n}": "طلبات دعم بانتظار ردك: {n}",
    "Open your dashboard": "افتح لوحة التحكم",
    "You get this because the daily summary is on.": "وصلتك هذه الرسالة لأن الملخص اليومي مفعّل.",
    "change your notification settings": "غيّر إعدادات الإشعارات",
    "Your daily {product} summary": "ملخصك اليومي في {product}",
    # ---- API messages
    "Too many wrong codes. Wait a few minutes and try again.": "محاولات خاطئة كثيرة. انتظر بضع دقائق ثم حاول مجددًا.",
    "That code is not correct. Check the code and try again.": "هذا الرمز غير صحيح. تحقق من الرمز وحاول مجددًا.",
    "This sign-in step has expired. Sign in again.": "انتهت صلاحية خطوة تسجيل الدخول هذه. سجّل الدخول مجددًا.",
    "2-step verification is already on.": "التحقق بخطوتين مفعّل بالفعل.",
    "Start setting up 2-step verification first.": "ابدأ أولًا بإعداد التحقق بخطوتين.",
    "2-step verification is not turned on.": "التحقق بخطوتين غير مفعّل.",
    "Your company requires 2-step verification, so it cannot be turned off.": "شركتك تشترط التحقق بخطوتين، لذلك لا يمكن إيقافه.",
    "This is the device you are using now. Use Sign out instead.": "هذا هو الجهاز الذي تستخدمه الآن. استخدم تسجيل الخروج بدلًا من ذلك.",
    "Sign in again to use this.": "سجّل الدخول مجددًا لاستخدام هذه الميزة.",
    "Your company requires 2-step verification. Turn it on in Settings > Security to continue.":
        "شركتك تشترط التحقق بخطوتين. فعّله من الإعدادات > الأمان للمتابعة.",
    "Turn on 2-step verification for your own account first, then require it for your company.":
        "فعّل التحقق بخطوتين لحسابك أولًا، ثم اشترطه على شركتك.",
    "Enter a company domain such as northgate.com.": "أدخل نطاق الشركة مثل northgate.com.",
    "Free e-mail domains such as gmail.com cannot be verified. Use your company's own domain.":
        "لا يمكن توثيق نطاقات البريد المجانية مثل gmail.com. استخدم نطاق شركتك الخاص.",
    "Another company has already verified this domain.": "شركة أخرى وثّقت هذا النطاق بالفعل.",
    "A company can verify up to 5 domains. Remove one first.": "يمكن للشركة توثيق ما يصل إلى 5 نطاقات. احذف نطاقًا أولًا.",
    "Use admin, postmaster or webmaster, or an address at the domain.": "استخدم admin أو postmaster أو webmaster، أو عنوانًا على هذا النطاق.",
    "A message was just sent. Wait a minute before asking for another.": "تم إرسال رسالة للتو. انتظر دقيقة قبل طلب رسالة أخرى.",
    "That code is not correct. Ask for a new one.": "هذا الرمز غير صحيح. اطلب رمزًا جديدًا.",
    "This confirmation link is not valid or has already been used.": "رابط التأكيد هذا غير صالح أو سبق استخدامه.",
    "This confirmation has expired. Ask for a new one.": "انتهت صلاحية هذا التأكيد. اطلب تأكيدًا جديدًا.",
    "This is only available for company workspaces.": "هذه الميزة متاحة لمساحات عمل الشركات فقط.",
    "Browser notifications are not set up on this server.": "إشعارات المتصفح غير مُعدّة على هذا الخادم.",
    "This browser's push address is not accepted.": "عنوان الإشعارات الخاص بهذا المتصفح غير مقبول.",
    "Enter one valid e-mail address.": "أدخل عنوان بريد إلكتروني واحدًا صالحًا.",
    "Choose a valid time zone.": "اختر منطقة زمنية صالحة.",
    # ---- card buttons, uploaded files and the card list
    "Enter a web address that starts with https://.": "أدخل عنوان ويب يبدأ بـ https://.",
    "This link does not match the type of button you chose.": "هذا الرابط لا يطابق نوع الزر الذي اخترته.",
    "Upload the PDF first and use the address we returned.": "ارفع ملف PDF أولًا واستخدم العنوان الذي أعطيناك إياه.",
    "Choose a PDF file.": "اختر ملف PDF.",
    "The PDF must be under 10 MB.": "يجب أن يكون حجم ملف PDF أقل من 10 ميغابايت.",
    "Upload a PDF file.": "ارفع ملف PDF.",
    "This PDF contains scripts or embedded files. Export a plain PDF and try again.":
        "يحتوي هذا الملف على برامج نصية أو ملفات مضمنة. صدّر ملف PDF عاديًا وحاول مجددًا.",
    "A card can hold up to 5 uploaded files. Remove a Download file button first.":
        "يمكن أن تحتوي البطاقة على 5 ملفات مرفوعة كحد أقصى. احذف زر تنزيل ملف أولًا.",
    "List every card once, in the order you want.": "اذكر كل بطاقة مرة واحدة بالترتيب الذي تريده.",
    # ---- the company activity log
    "Turned the company 2-step rule on or off": "شغّل شرط التحقق بخطوتين للشركة أو أوقفه",
    "Verified a company domain": "وثّق نطاقًا للشركة",
    "Removed a company domain": "أزال نطاقًا للشركة",
    "Changed the company reply-to address": "غيّر عنوان الرد الخاص ببريد الشركة",
    "Choose a country from the list.": "اختر دولة من القائمة.",
    "The country is only available on company workspaces.": "الدولة متاحة لمساحات الشركات فقط.",
}

PATTERNS = []
