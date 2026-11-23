"""Every message the staff, request and custom face code can show a person must have an Arabic wording.

The check reads the source of the new modules, collects the English sentences passed to ApiError, validation_error,
the sanitiser's warnings and errors, e-mails and the staff audit labels, and asks the Arabic catalogue to translate each."""
import ast
import re
import unittest
from pathlib import Path

from ilaf import locale_ar
from ilaf.i18n import translate_message, tr

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    "staff/views.py", "staff/services.py", "staff/permissions.py", "designs/views.py", "designs/staff_views.py",
    "designs/services.py", "designs/sanitize.py",
]
# parts of a sentence that are filled in at run time
SAMPLE = "5"


def text_of(node):
    """The sentence of a string or f-string node, with each filled-in part shown as {0}, {1}... , or None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        out, n = [], 0
        for part in node.values:
            if isinstance(part, ast.Constant):
                out.append(part.value)
            else:
                out.append("{%d}" % n)
                n += 1
        return "".join(out)
    return None


def collect():
    found = {}

    def add(text, where):
        if text and re.search(r"[A-Za-z]{3}", text) and not re.fullmatch(r"[a-z_.]+", text) and not text.startswith("{0}/") and not text.startswith("Colourway {0}: {1} (contrast"):
            found.setdefault(text, where)

    for rel in FILES:
        tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
                if name == "ApiError" and len(node.args) >= 2:
                    add(text_of(node.args[1]), rel)
                elif name == "validation_error" and node.args and isinstance(node.args[0], ast.Dict):
                    for value in node.args[0].values:
                        if isinstance(value, ast.List):
                            for item in value.elts:
                                add(text_of(item), rel)
                elif name == "add" and rel.endswith("sanitize.py") and len(node.args) >= 2:
                    add(text_of(node.args[1]), rel)
                elif name == "append" and node.args and isinstance(getattr(node.func, "value", None), ast.Name) and node.func.value.id == "problems":
                    add(text_of(node.args[0]), rel)
                elif name in ("notify_customer", "notify_face_disabled", "tr"):
                    for arg in node.args:
                        if isinstance(arg, ast.List):
                            for item in arg.elts:
                                add(text_of(item), rel)
                        elif name == "tr":
                            continue
                        else:
                            add(text_of(arg), rel)
            if isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and k.value == "message":
                        add(text_of(v), rel)
            if isinstance(node, ast.Assign) and any(getattr(t, "id", "") in ("AUDIT_ACTIONS", "STATUS_MAIL") for t in node.targets):
                for sub in ast.walk(node.value):
                    add(text_of(sub), rel)
    return found


class DesignI18nTests(unittest.TestCase):
    def test_every_new_message_has_an_arabic_text(self):
        missing = []
        for text, where in sorted(collect().items()):
            sample = re.sub(r"\{\d+\}", SAMPLE, text)
            if translate_message("ar", sample) == sample and tr("ar", text) == text:
                missing.append(f"{where}: {text}")
        self.assertEqual(missing, [], "\n".join(missing))

    def test_palette_messages_are_translated(self):
        from ilaf.branding import PALETTE_CHECKS

        for _, _, needed, message in PALETTE_CHECKS:
            full = f"Colourway 2: {message} (contrast 3.1 to 1, needs {needed:g} to 1)."
            self.assertNotEqual(translate_message("ar", full), full, message)

    def test_catalogue_placeholders_match_the_english(self):
        for key, value in locale_ar.TEXTS.items():
            self.assertEqual(sorted(re.findall(r"\{\w+\}", key)), sorted(re.findall(r"\{\w+\}", value)), key)
