"""The countries a company can choose (ISO 3166-1 alpha-2) with an English and an Arabic name.

The web app lists the same codes in web/src/lib/countries.ts and words each name in the reader's language itself; the
names here are for e-mails, exports and the staff screens. `country_or_none` is the one place a submitted code is checked.
"""

_TABLE = """
AD|Andorra|أندورا
AE|United Arab Emirates|الإمارات العربية المتحدة
AF|Afghanistan|أفغانستان
AG|Antigua and Barbuda|أنتيغوا وبربودا
AI|Anguilla|أنغويلا
AL|Albania|ألبانيا
AM|Armenia|أرمينيا
AO|Angola|أنغولا
AQ|Antarctica|القارة القطبية الجنوبية
AR|Argentina|الأرجنتين
AS|American Samoa|ساموا الأمريكية
AT|Austria|النمسا
AU|Australia|أستراليا
AW|Aruba|أروبا
AX|Åland Islands|جزر أولاند
AZ|Azerbaijan|أذربيجان
BA|Bosnia and Herzegovina|البوسنة والهرسك
BB|Barbados|بربادوس
BD|Bangladesh|بنغلاديش
BE|Belgium|بلجيكا
BF|Burkina Faso|بوركينا فاسو
BG|Bulgaria|بلغاريا
BH|Bahrain|البحرين
BI|Burundi|بوروندي
BJ|Benin|بنين
BL|Saint Barthélemy|سان بارتليمي
BM|Bermuda|برمودا
BN|Brunei|بروناي
BO|Bolivia|بوليفيا
BQ|Caribbean Netherlands|هولندا الكاريبية
BR|Brazil|البرازيل
BS|Bahamas|جزر البهاما
BT|Bhutan|بوتان
BV|Bouvet Island|جزيرة بوفيه
BW|Botswana|بوتسوانا
BY|Belarus|بيلاروس
BZ|Belize|بليز
CA|Canada|كندا
CC|Cocos (Keeling) Islands|جزر كوكوس (كيلينغ)
CD|Congo (DRC)|الكونغو الديمقراطية
CF|Central African Republic|جمهورية أفريقيا الوسطى
CG|Congo (Republic)|جمهورية الكونغو
CH|Switzerland|سويسرا
CI|Côte d'Ivoire|ساحل العاج
CK|Cook Islands|جزر كوك
CL|Chile|تشيلي
CM|Cameroon|الكاميرون
CN|China|الصين
CO|Colombia|كولومبيا
CR|Costa Rica|كوستاريكا
CU|Cuba|كوبا
CV|Cape Verde|الرأس الأخضر
CW|Curaçao|كوراساو
CX|Christmas Island|جزيرة كريسماس
CY|Cyprus|قبرص
CZ|Czechia|التشيك
DE|Germany|ألمانيا
DJ|Djibouti|جيبوتي
DK|Denmark|الدنمارك
DM|Dominica|دومينيكا
DO|Dominican Republic|جمهورية الدومينيكان
DZ|Algeria|الجزائر
EC|Ecuador|الإكوادور
EE|Estonia|إستونيا
EG|Egypt|مصر
EH|Western Sahara|الصحراء الغربية
ER|Eritrea|إريتريا
ES|Spain|إسبانيا
ET|Ethiopia|إثيوبيا
FI|Finland|فنلندا
FJ|Fiji|فيجي
FK|Falkland Islands|جزر فوكلاند
FM|Micronesia|ميكرونيزيا
FO|Faroe Islands|جزر فارو
FR|France|فرنسا
GA|Gabon|الغابون
GB|United Kingdom|المملكة المتحدة
GD|Grenada|غرينادا
GE|Georgia|جورجيا
GF|French Guiana|غيانا الفرنسية
GG|Guernsey|غيرنزي
GH|Ghana|غانا
GI|Gibraltar|جبل طارق
GL|Greenland|غرينلاند
GM|Gambia|غامبيا
GN|Guinea|غينيا
GP|Guadeloupe|غوادلوب
GQ|Equatorial Guinea|غينيا الاستوائية
GR|Greece|اليونان
GS|South Georgia and the South Sandwich Islands|جورجيا الجنوبية وجزر ساندويتش الجنوبية
GT|Guatemala|غواتيمالا
GU|Guam|غوام
GW|Guinea-Bissau|غينيا بيساو
GY|Guyana|غيانا
HK|Hong Kong|هونغ كونغ
HM|Heard Island and McDonald Islands|جزيرة هيرد وجزر ماكدونالد
HN|Honduras|هندوراس
HR|Croatia|كرواتيا
HT|Haiti|هايتي
HU|Hungary|المجر
ID|Indonesia|إندونيسيا
IE|Ireland|أيرلندا
IL|Israel|إسرائيل
IM|Isle of Man|جزيرة مان
IN|India|الهند
IO|British Indian Ocean Territory|إقليم المحيط الهندي البريطاني
IQ|Iraq|العراق
IR|Iran|إيران
IS|Iceland|آيسلندا
IT|Italy|إيطاليا
JE|Jersey|جيرسي
JM|Jamaica|جامايكا
JO|Jordan|الأردن
JP|Japan|اليابان
KE|Kenya|كينيا
KG|Kyrgyzstan|قيرغيزستان
KH|Cambodia|كمبوديا
KI|Kiribati|كيريباتي
KM|Comoros|جزر القمر
KN|Saint Kitts and Nevis|سانت كيتس ونيفيس
KP|North Korea|كوريا الشمالية
KR|South Korea|كوريا الجنوبية
KW|Kuwait|الكويت
KY|Cayman Islands|جزر كايمان
KZ|Kazakhstan|كازاخستان
LA|Laos|لاوس
LB|Lebanon|لبنان
LC|Saint Lucia|سانت لوسيا
LI|Liechtenstein|ليختنشتاين
LK|Sri Lanka|سريلانكا
LR|Liberia|ليبيريا
LS|Lesotho|ليسوتو
LT|Lithuania|ليتوانيا
LU|Luxembourg|لوكسمبورغ
LV|Latvia|لاتفيا
LY|Libya|ليبيا
MA|Morocco|المغرب
MC|Monaco|موناكو
MD|Moldova|مولدوفا
ME|Montenegro|الجبل الأسود
MF|Saint Martin|سانت مارتن
MG|Madagascar|مدغشقر
MH|Marshall Islands|جزر مارشال
MK|North Macedonia|مقدونيا الشمالية
ML|Mali|مالي
MM|Myanmar|ميانمار
MN|Mongolia|منغوليا
MO|Macao|ماكاو
MP|Northern Mariana Islands|جزر ماريانا الشمالية
MQ|Martinique|مارتينيك
MR|Mauritania|موريتانيا
MS|Montserrat|مونتسرات
MT|Malta|مالطا
MU|Mauritius|موريشيوس
MV|Maldives|جزر المالديف
MW|Malawi|مالاوي
MX|Mexico|المكسيك
MY|Malaysia|ماليزيا
MZ|Mozambique|موزمبيق
NA|Namibia|ناميبيا
NC|New Caledonia|كاليدونيا الجديدة
NE|Niger|النيجر
NF|Norfolk Island|جزيرة نورفولك
NG|Nigeria|نيجيريا
NI|Nicaragua|نيكاراغوا
NL|Netherlands|هولندا
NO|Norway|النرويج
NP|Nepal|نيبال
NR|Nauru|ناورو
NU|Niue|نيوي
NZ|New Zealand|نيوزيلندا
OM|Oman|عُمان
PA|Panama|بنما
PE|Peru|بيرو
PF|French Polynesia|بولينيزيا الفرنسية
PG|Papua New Guinea|بابوا غينيا الجديدة
PH|Philippines|الفلبين
PK|Pakistan|باكستان
PL|Poland|بولندا
PM|Saint Pierre and Miquelon|سان بيير وميكلون
PN|Pitcairn Islands|جزر بيتكيرن
PR|Puerto Rico|بورتوريكو
PS|Palestine|فلسطين
PT|Portugal|البرتغال
PW|Palau|بالاو
PY|Paraguay|باراغواي
QA|Qatar|قطر
RE|Réunion|ريونيون
RO|Romania|رومانيا
RS|Serbia|صربيا
RU|Russia|روسيا
RW|Rwanda|رواندا
SA|Saudi Arabia|المملكة العربية السعودية
SB|Solomon Islands|جزر سليمان
SC|Seychelles|سيشل
SD|Sudan|السودان
SE|Sweden|السويد
SG|Singapore|سنغافورة
SH|Saint Helena|سانت هيلانة
SI|Slovenia|سلوفينيا
SJ|Svalbard and Jan Mayen|سفالبارد ويان ماين
SK|Slovakia|سلوفاكيا
SL|Sierra Leone|سيراليون
SM|San Marino|سان مارينو
SN|Senegal|السنغال
SO|Somalia|الصومال
SR|Suriname|سورينام
SS|South Sudan|جنوب السودان
ST|São Tomé and Príncipe|ساو تومي وبرينسيبي
SV|El Salvador|السلفادور
SX|Sint Maarten|سينت مارتن
SY|Syria|سوريا
SZ|Eswatini|إسواتيني
TC|Turks and Caicos Islands|جزر توركس وكايكوس
TD|Chad|تشاد
TF|French Southern Territories|الأقاليم الجنوبية الفرنسية
TG|Togo|توغو
TH|Thailand|تايلاند
TJ|Tajikistan|طاجيكستان
TK|Tokelau|توكيلاو
TL|Timor-Leste|تيمور الشرقية
TM|Turkmenistan|تركمانستان
TN|Tunisia|تونس
TO|Tonga|تونغا
TR|Türkiye|تركيا
TT|Trinidad and Tobago|ترينيداد وتوباغو
TV|Tuvalu|توفالو
TW|Taiwan|تايوان
TZ|Tanzania|تنزانيا
UA|Ukraine|أوكرانيا
UG|Uganda|أوغندا
UM|U.S. Outlying Islands|جزر الولايات المتحدة النائية
US|United States|الولايات المتحدة
UY|Uruguay|أوروغواي
UZ|Uzbekistan|أوزبكستان
VA|Vatican City|الفاتيكان
VC|Saint Vincent and the Grenadines|سانت فينسنت والغرينادين
VE|Venezuela|فنزويلا
VG|British Virgin Islands|جزر العذراء البريطانية
VI|U.S. Virgin Islands|جزر العذراء الأمريكية
VN|Vietnam|فيتنام
VU|Vanuatu|فانواتو
WF|Wallis and Futuna|والس وفوتونا
WS|Samoa|ساموا
XK|Kosovo|كوسوفو
YE|Yemen|اليمن
YT|Mayotte|مايوت
ZA|South Africa|جنوب أفريقيا
ZM|Zambia|زامبيا
ZW|Zimbabwe|زيمبابوي
"""

COUNTRIES = {}
for _line in _TABLE.strip().splitlines():
    _code, _en, _ar = _line.split("|")
    COUNTRIES[_code] = {"en": _en, "ar": _ar}


def country_or_none(value):
    """The upper-case code for a submitted country, "" for an empty value, or None when it is not in the list."""
    if value is None:
        return ""
    code = str(value).strip().upper()
    if not code:
        return ""
    return code if code in COUNTRIES else None


def country_name(code, lang="en"):
    """The name of a country in English or Arabic; an unknown code is returned as it is."""
    entry = COUNTRIES.get(str(code or "").upper())
    return entry["ar" if lang == "ar" else "en"] if entry else str(code or "")
