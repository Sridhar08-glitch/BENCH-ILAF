"""Branded transactional emails: ink text on white with one orange button, the BENCH wordmark on top and
"BENCH by <company>" with the company logo at the bottom. Poppins is named first; mail apps without it use Arial.

Every builder takes `lang`. A right-to-left language (Arabic) gets `dir="rtl"`, right-aligned text, a font stack
that starts with Arabic-capable fonts, and the "by" line in the language. The callers pass texts that are
already translated (see `ilaf.i18n.tr`)."""
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from .i18n import DEFAULT_LANGUAGE, direction, is_rtl, normalise_language, tr

# Mail apps rarely have web fonts, so the Arabic stack names fonts that ship with the common systems.
ARABIC_FONT = "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, 'Noto Sans Arabic', 'Geeza Pro', Arial, sans-serif"


def font_stack(lang):
    return ARABIC_FONT if is_rtl(lang) else settings.BRAND_FONT


def html_attrs(lang):
    """The `lang` and `dir` attributes for the e-mail's root element."""
    code = normalise_language(lang) or DEFAULT_LANGUAGE
    return f'lang="{code}" dir="{direction(code)}"'


def start_align(lang):
    return "right" if is_rtl(lang) else "left"


def end_align(lang):
    return "left" if is_rtl(lang) else "right"


def _by_line(lang):
    """"BENCH by <company logo>" in the language; the product name stays Latin."""
    company_logo = f"{settings.WEB_BASE_URL}/brand/ilaf-logo.png"
    side = "right" if is_rtl(lang) else "left"
    by = tr(lang, "{product} by", product=settings.PRODUCT_NAME)
    return (
        f'<p style="margin:0;font-size:12px;color:{settings.BRAND_MUTED};text-align:{start_align(lang)};">{escape(by)} '
        f'<img src="{escape(company_logo, quote=True)}" alt="{escape(settings.COMPANY_NAME)}" height="14" '
        f'style="height:14px;vertical-align:middle;margin-{side}:4px;"></p>'
    )


# Dark-mode mail apps that honour the scheme get a dark page; the company logo always sits on a white chip, so a dark
# logo stays readable.
_DARK_CSS = (
    "<style>@media (prefers-color-scheme: dark){body,.bench-wrap{background:#101114!important;color:#F4F4F6!important}"
    ".bench-wrap h1,.bench-wrap p{color:#F4F4F6!important}}</style>"
)


def _header_logo(style):
    """The image at the top of the mail: the company logo on a white chip when it has a usable one, else the company name, else the product wordmark."""
    if style and style.get("logo"):
        return (
            f'<div style="margin-bottom:24px;"><span style="display:inline-block;background:#FFFFFF;border-radius:12px;padding:8px 12px;">'
            f'<img src="{escape(style["logo"], quote=True)}" alt="{escape(style["name"])}" height="36" '
            f'style="height:36px;max-width:200px;vertical-align:middle;"></span></div>'
        )
    if style:
        return f'<p style="margin:0 0 24px;font-size:20px;font-weight:800;">{escape(style["name"])}</p>'
    logo = f"{settings.WEB_BASE_URL}/brand/bench-logo.png"
    return (
        f'<img src="{escape(logo, quote=True)}" alt="{escape(settings.PRODUCT_NAME)}" height="32" '
        f'style="height:32px;margin-bottom:24px;">'
    )


def _frame(lang, width, heading, inner, heading_margin, style=None):
    align = start_align(lang)
    return (
        f'<!doctype html><html {html_attrs(lang)}><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">{_DARK_CSS}</head>'
        f'<body style="margin:0;background:{settings.BRAND_BACKGROUND};">'
        f'<div class="bench-wrap" style="max-width:{width}px;margin:0 auto;padding:32px 24px;direction:{direction(lang)};text-align:{align};'
        f'font-family:{font_stack(lang)};color:{settings.BRAND_BLACK};">'
        f'{_header_logo(style)}'
        f'<h1 style="margin:0 0 {heading_margin}px;font-size:22px;font-weight:800;'
        f'letter-spacing:{"0" if is_rtl(lang) else "-0.5px"};color:{settings.BRAND_BLACK};">{escape(heading)}</h1>'
        f"{inner}"
        f"</div></body></html>"
    )


def deliver(message, kind="transactional", fail_silently=False):
    """Send a prepared message and write one line to the staff e-mail log (a failed one keeps its body so staff can resend it).
    Returns True when the mail server took it. With `fail_silently` a refusal is not raised."""
    try:
        message.send(fail_silently=False)
    except Exception as exc:
        _log_email(message, kind, False, exc)
        if not fail_silently:
            raise
        return False
    _log_email(message, kind, True, None)
    return True


def _log_email(message, kind, ok, exc):
    try:
        from staff.ops_services import record_email

        record_email(message, kind, ok, exc)
    except Exception:  # the log is a convenience; it must never stop a mail
        pass


def build_brand_email(heading, paragraphs, button_text=None, button_url=None, lang=DEFAULT_LANGUAGE, workspace=None):
    """(text, html, style) of a branded e-mail. With a company `workspace` the mail carries the company's logo and
    button colour (see ilaf.company_mail); `style` is that look, or None for the plain product look."""
    from .company_mail import company_style

    style = company_style(workspace)
    text_parts = [heading, ""] + list(paragraphs)
    if button_text and button_url:
        text_parts += ["", f"{button_text}: {button_url}"]
    by = tr(lang, "{product} by", product=settings.PRODUCT_NAME)
    text_parts += ["", f"{by} {settings.COMPANY_NAME} - {settings.COMPANY_SITE}"]
    line_height = 1.9 if is_rtl(lang) else 1.6
    body_html = "".join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:{line_height};color:{settings.BRAND_BLACK};">{escape(p)}</p>'
        for p in paragraphs
    )
    button_html = ""
    if button_text and button_url:
        button_html = (
            f'<p style="margin:24px 0;"><a href="{escape(button_url, quote=True)}" '
            f'style="display:inline-block;background:{style["accent"] if style else settings.BRAND_ORANGE};'
            f'color:{style["on"] if style else settings.BRAND_BLACK};'
            f'text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px;">'
            f"{escape(button_text)}</a></p>"
        )
    inner = (
        f"{body_html}{button_html}"
        f'<hr style="border:none;border-top:1px solid {settings.BRAND_BORDER};margin:32px 0 12px;">'
        f"{_by_line(lang)}"
    )
    return "\n".join(text_parts), _frame(lang, 520, heading, inner, 16, style), style


def send_brand_email(to, subject, heading, paragraphs, button_text=None, button_url=None, lang=DEFAULT_LANGUAGE, kind="transactional", headers=None, workspace=None):
    """Send a text + HTML email. `paragraphs` are plain strings (they are escaped for the HTML part).
    `workspace` (a company) gives the mail the company's look, a "Company via Product" sender and its reply-to address."""
    text, html, style = build_brand_email(heading, paragraphs, button_text, button_url, lang, workspace)
    message = EmailMultiAlternatives(
        subject, text, style["from"] if style else settings.DEFAULT_FROM_EMAIL, [to], headers=headers or {},
        reply_to=style["reply_to"] if style else None,
    )
    message.attach_alternative(html, "text/html")
    deliver(message, kind, fail_silently=True)


def brand_html_page(heading, body_html, footer_html="", subtitle="", lang=DEFAULT_LANGUAGE):
    """The branded e-mail frame around ready-made HTML (tables, tiles): wordmark on top, company lockup at the bottom.
    `body_html` and `footer_html` must already be escaped."""
    sub = (
        f'<p style="margin:0 0 20px;font-size:14px;color:{settings.BRAND_MUTED};">{escape(subtitle)}</p>' if subtitle else ""
    )
    inner = (
        f"{sub}{body_html}"
        f'<hr style="border:none;border-top:1px solid {settings.BRAND_BORDER};margin:32px 0 12px;">'
        f"{footer_html}{_by_line(lang)}"
    )
    return _frame(lang, 600, heading, inner, 6)


def send_brand_html(to, subject, text, html, headers=None):
    """Send a text + HTML e-mail that was built with `brand_html_page`. Raises when the mail server refuses."""
    message = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [to], headers=headers or {})
    message.attach_alternative(html, "text/html")
    deliver(message, "transactional", fail_silently=False)
