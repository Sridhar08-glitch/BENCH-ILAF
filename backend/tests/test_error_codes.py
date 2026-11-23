"""Every message a user can see exists in English and Arabic.

* the error registry (ilaf/error_codes.py) is in step with the code that raises the errors,
* every literal message the API can answer has an Arabic text on the server,
* every error code has an `apiError.<code>` text in the web catalogue, English and Arabic,
* every sentence passed to the translator `tr` / `trn` (e-mails, notices) has its Arabic text,
* every e-mail sender is told the recipient's language.
"""
import ast
import importlib.util
import re
from pathlib import Path

from django.test import SimpleTestCase

from ilaf import locale_ar
from ilaf.error_codes import ERROR_CODES, ERROR_MESSAGES
from ilaf.i18n import translate_message

BACKEND = Path(__file__).resolve().parent.parent
WEB_I18N = BACKEND.parent / "web" / "src" / "lib" / "i18n"
SKIP = {".venv", "tests", "migrations", "__pycache__", "media", "private_exports", "scripts"}


def _python_files():
    for path in sorted(BACKEND.rglob("*.py")):
        if not any(part in SKIP for part in path.relative_to(BACKEND).parts):
            yield path


def _web_codes(lang):
    text = (WEB_I18N / lang / "apiError.ts").read_text(encoding="utf-8")
    return set(re.findall(r'"apiError\.([a-z0-9_]+)":', text))


class ErrorRegistryTests(SimpleTestCase):
    def test_registry_is_in_step_with_the_code(self):
        spec = importlib.util.spec_from_file_location("extract_error_codes", BACKEND / "scripts" / "extract_error_codes.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        found, messages, _dynamic = module.build()
        current_text = (BACKEND / "ilaf" / "error_codes.py").read_text(encoding="utf-8")
        self.assertEqual(
            current_text.replace("\r\n", "\n"), module.render(found, messages, _dynamic),
            "ilaf/error_codes.py is out of date: run `python scripts/extract_error_codes.py` in backend/",
        )

    def test_every_code_has_a_status_and_an_english_text(self):
        for code, row in ERROR_CODES.items():
            self.assertRegex(code, r"^[a-z][a-z0-9_]*$")
            self.assertTrue(row["message"].strip(), code)
            self.assertIn("status", row)

    def test_every_message_has_an_arabic_text(self):
        missing = []
        for code, message in ERROR_MESSAGES:
            sample = re.sub(r"\{[A-Za-z_0-9]+\}", "5", message)
            if translate_message("ar", sample) == sample:
                missing.append(f"{code}: {message}")
        self.assertEqual(missing, [], "add these to ilaf/locale_ar_errors.py")


class WebCatalogueTests(SimpleTestCase):
    def test_every_code_is_in_the_web_catalogue_in_both_languages(self):
        for lang in ("en", "ar"):
            missing = sorted(set(ERROR_CODES) - _web_codes(lang))
            self.assertEqual(missing, [], f"web/src/lib/i18n/{lang}/apiError.ts lacks these codes")

    def test_the_web_catalogue_has_no_code_the_api_never_sends(self):
        for lang in ("en", "ar"):
            extra = sorted(_web_codes(lang) - set(ERROR_CODES) - {"generic", "field"})
            self.assertEqual(extra, [], f"web/src/lib/i18n/{lang}/apiError.ts has codes that are not in the registry")


class TranslatorTests(SimpleTestCase):
    def test_every_sentence_given_to_tr_has_an_arabic_text(self):
        missing = []
        for path in _python_files():
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
                if name == "tr" and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant) and isinstance(node.args[1].value, str):
                    if node.args[1].value not in locale_ar.TEXTS:
                        missing.append(f"{path.relative_to(BACKEND).as_posix()}:{node.lineno}: {node.args[1].value}")
                elif name == "trn" and len(node.args) >= 3 and isinstance(node.args[2], ast.Constant) and isinstance(node.args[2].value, str):
                    if node.args[2].value not in locale_ar.PLURALS:
                        missing.append(f"{path.relative_to(BACKEND).as_posix()}:{node.lineno}: {node.args[2].value}")
        self.assertEqual(missing, [], "add these sentences to ilaf/locale_ar*.py")

    def test_email_subjects_and_headings_are_not_written_in_english_in_place(self):
        """The subject, heading and button of an e-mail come from `tr(...)` (or a variable built from it), never a bare literal."""
        bare = []
        for path in _python_files():
            if path.name == "emails.py":
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", "")) == "send_brand_email":
                    keyword = {kw.arg: kw.value for kw in node.keywords}
                    picked = {
                        "subject": node.args[1] if len(node.args) > 1 else keyword.get("subject"),
                        "heading": node.args[2] if len(node.args) > 2 else keyword.get("heading"),
                        "button_text": node.args[4] if len(node.args) > 4 else keyword.get("button_text"),
                    }
                    for label, value in picked.items():
                        if isinstance(value, (ast.Constant, ast.JoinedStr)) and not (isinstance(value, ast.Constant) and value.value is None):
                            bare.append(f"{path.relative_to(BACKEND).as_posix()}:{node.lineno} {label}")
                    body = node.args[3] if len(node.args) > 3 else keyword.get("paragraphs")
                    if isinstance(body, ast.List):
                        for element in body.elts:
                            if isinstance(element, (ast.Constant, ast.JoinedStr)):
                                bare.append(f"{path.relative_to(BACKEND).as_posix()}:{node.lineno} paragraph")
        self.assertEqual(bare, [], "wrap these in tr(lang, ...) and add the Arabic text")

    def test_every_email_sender_is_told_the_language(self):
        """send_brand_email(to, subject, heading, paragraphs, button_text, button_url, lang): lang is the 7th argument."""
        silent = []
        for path in _python_files():
            if path.name == "emails.py":
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", "")) == "send_brand_email":
                    has_lang = len(node.args) >= 7 or any(kw.arg == "lang" for kw in node.keywords)
                    if not has_lang:
                        silent.append(f"{path.relative_to(BACKEND).as_posix()}:{node.lineno}")
        self.assertEqual(silent, [], "pass lang=<the recipient's language> so the e-mail is not English-only")
