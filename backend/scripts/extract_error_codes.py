"""Find every API error the backend can raise and write them to ilaf/error_codes.py.

Run from the backend folder:  python scripts/extract_error_codes.py           (rewrite the registry)
                              python scripts/extract_error_codes.py --check   (exit 1 when it is out of date)

It reads the source with `ast`, so nothing is imported or executed. It looks at:
  * ApiError("code", "message", status) and the small helpers that wrap it (refuse, _deny),
  * dict literals shaped like {"error": {"code": ..., "message": ...}},
  * the codes ilaf/errors.py answers for the framework's own exceptions.
A message written as an f-string is recorded with its {placeholders}; those names are the code's params.
A call whose code or message is not a literal is listed under DYNAMIC so a person can review it.
The hand-kept part of the registry (the plain-English default of a code, the status, the params) lives in
EXTRA_CODES below.
"""
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ilaf" / "error_codes.py"
SKIP_FILES = {"publicapi/spec.py", "ilaf/error_codes.py"}  # the API description lists codes in prose, it raises nothing
SKIP_DIRS = {".venv", "tests", "migrations", "__pycache__", "media", "scripts", "private_exports"}

# Wrappers around ApiError: name -> (index of code arg or None, default code, index of message arg, index of status arg, default status)
WRAPPERS = {
    "ApiError": (0, None, 1, 2, 400),
    "error_body": (0, None, 1, None, 400),
    "_deny": (0, None, 1, 2, 401),
    "refuse": (None, "forbidden", 0, 2, 403),
    "_locked": (None, "field_locked", 1, None, 403),
    "not_configured": (None, "wallet_not_configured", 0, None, 503),
    "_bad_link": (0, "download_invalid", 1, None, 410),
    "invalid": (None, "google_token_invalid", 0, None, 401),
}
# Messages a helper uses when the call gives none.
DEFAULT_MESSAGES = {
    "not_configured": "Google Wallet passes are not set up on this server.",
    "_bad_link": "This download link is not valid.",
    "invalid": "We could not verify your Google sign-in. Please try again.",
}
# Functions that return ("invalid"|"taken", message): "taken" is the slug_taken code, the rest a validation error.
CRM_DEFAULT = "The CRM could not complete the request."
FIELD_MESSAGE_CALLS = {"ValidationError", "validation_error", "_fail", "PermissionDenied"}
PROBLEM_FUNCTIONS = {"slug_problem", "directory_slug_problem"}
# `refuse(message, code, status)`: code is argument 1.
REFUSE_CODE_INDEX = 1

# Codes the framework answers itself (ilaf/errors.py) or that the web app's own routes use.
EXTRA_CODES = {
    "unauthorized": ("Please sign in to continue.", 401, []),
    "forbidden": ("You do not have permission to do that.", 403, []),
    "not_found": ("Not found.", 404, []),
    "throttled": ("Too many requests. Please wait a moment and try again.", 429, ["retry_after"]),
    "validation_error": ("Please check the highlighted fields.", 400, []),
    "method_not_allowed": ("Method not allowed.", 405, []),
    "server_error": ("Something went wrong on our side.", 500, []),
    "network_error": ("The service cannot be reached right now. Please try again.", 0, []),
    "origin_refused": ("This request did not come from the app. Reload the page and try again.", 403, []),
}


# What Django REST framework and Django's password checks say when a field is wrong (they are English and reach the screen).
FRAMEWORK_MESSAGES = [
    "This field is required.", "This field may not be null.", "This field may not be blank.", "Not a valid string.",
    "A valid integer is required.", "A valid number is required.", "Must be a valid boolean.", "Enter a valid URL.",
    "Enter a valid UUID.", "Enter a valid email address.", "Enter a valid value.", "This list may not be empty.",
    "Ensure this field has no more than {n} characters.", "Ensure this field has at least {n} characters.",
    "Ensure this value is less than or equal to {n}.", "Ensure this value is greater than or equal to {n}.",
    "Date has wrong format. Use one of these formats instead: {formats}.",
    "Datetime has wrong format. Use one of these formats instead: {formats}.",
    '"{input}" is not a valid choice.', 'Expected a list of items but got type "{type}".',
    "Invalid data. Expected a dictionary, but got {type}.", "Upload a valid image. The file you uploaded was either not an image or a corrupted image.",
    "No file was submitted.", "The submitted file is empty.",
    "This password is too short. It must contain at least {n} characters.", "This password is too common.",
    "This password is entirely numeric.",
]


def _text(node):
    """(text, params) of a string literal or f-string, else (None, [])."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value, []
    if isinstance(node, ast.JoinedStr):
        out, params = [], []
        for part in node.values:
            if isinstance(part, ast.Constant):
                out.append(str(part.value))
            elif isinstance(part, ast.FormattedValue) and isinstance(part.value, ast.IfExp) and any(
                isinstance(b, ast.Constant) and b.value == "" for b in (part.value.body, part.value.orelse)
            ):
                continue  # a plural ending such as 's' if n != 1 else ''
            elif isinstance(part, ast.FormattedValue):
                inner = part.value
                name = inner.attr if isinstance(inner, ast.Attribute) else inner.id if isinstance(inner, ast.Name) else "value"
                name = name.lower()
                params.append(name)
                out.append("{" + name + "}")
        return "".join(out), params
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, lp = _text(node.left)
        right, rp = _text(node.right)
        if left is not None and right is not None:
            return left + right, lp + rp
        if left is not None:
            return left + "{value}", lp + ["value"]
    return None, []


def _int(node, default):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, int) else default


def _arg(call, index, name):
    if index is not None and len(call.args) > index:
        return call.args[index]
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def scan():
    found = {}  # code -> {"message": str, "status": int, "params": set, "sites": int}
    messages = {}  # (code, message) -> params
    dynamic = []
    for path in sorted(ROOT.rglob("*.py")):
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts) or rel.as_posix() in SKIP_FILES:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fname = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
                if fname in FIELD_MESSAGE_CALLS:
                    for arg in list(node.args) + [kw.value for kw in node.keywords]:
                        _collect_texts(arg, found, messages)
                elif fname == "append" and isinstance(node.func, ast.Attribute) and "error" in ast.unparse(node.func.value).lower():
                    for arg in node.args:
                        _collect_texts(arg, found, messages)
                if fname in WRAPPERS:
                    code_i, default_code, msg_i, status_i, default_status = WRAPPERS[fname]
                    if fname == "refuse":
                        code_node = _arg(node, REFUSE_CODE_INDEX, "code")
                        code = _text(code_node)[0] if code_node is not None else default_code
                    else:
                        code = _text(_arg(node, code_i, "code"))[0] if _arg(node, code_i, "code") is not None else default_code
                    msg_node = _arg(node, msg_i, "message")
                    message, params = _text(msg_node) if msg_node is not None else (DEFAULT_MESSAGES.get(fname), [])
                    status = _int(_arg(node, status_i, "status_code") or _arg(node, status_i, "status"), default_status)
                    if code is None or message is None:
                        dynamic.append(f"{rel.as_posix()}:{node.lineno} {fname}(...)")
                        if code is not None:
                            found.setdefault(code, {"message": None, "status": status, "params": set()})
                        continue
                    _note(found, messages, code, message, status, params)
            elif isinstance(node, (ast.Assign, ast.AugAssign)) and _is_errors_target(node):
                _collect_texts(node.value, found, messages)
            elif isinstance(node, ast.ClassDef):
                _scan_crm_class(node, found, messages)
            elif isinstance(node, ast.FunctionDef):
                _scan_function(node, found, messages)
                if node.name in DEFAULT_MESSAGES:
                    _note(found, messages, WRAPPERS[node.name][1], DEFAULT_MESSAGES[node.name], WRAPPERS[node.name][4], [])
            elif isinstance(node, ast.Dict):
                keys = {k.value: v for k, v in zip(node.keys, node.values) if isinstance(k, ast.Constant)}
                if "reason" in keys:  # a refused item of a bulk run or an import: its reason is shown on screen
                    _collect_texts(keys["reason"], found, messages)
                if "error" in keys and isinstance(keys["error"], ast.Dict):
                    inner = {k.value: v for k, v in zip(keys["error"].keys, keys["error"].values) if isinstance(k, ast.Constant)}
                    if "code" in inner and "message" in inner:
                        code = _text(inner["code"])[0]
                        message, params = _text(inner["message"])
                        if code and message:
                            _note(found, messages, code, message, 400, params)
    return found, messages, dynamic


def _scan_function(node, found, messages):
    """The (code, message) tuples a slug checker returns."""
    if node.name not in PROBLEM_FUNCTIONS:
        return
    for sub in ast.walk(node):
        if isinstance(sub, ast.Return) and isinstance(sub.value, ast.Tuple) and len(sub.value.elts) == 2:
            kind, message = (_text(e)[0] for e in sub.value.elts)
            if kind and message:
                if kind == "taken":
                    _note(found, messages, "slug_taken", message, 409, [])
                else:
                    _note(found, messages, "validation_error", message, 400, [])


def _scan_crm_class(node, found, messages):
    """A CrmError subclass with a literal `code`: the settings page words it, so its default is a generic line."""
    for stmt in node.body:
        if isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "code" for t in stmt.targets):
            code = _text(stmt.value)[0]
            if code and code.startswith("crm_"):
                found.setdefault(code, {"message": CRM_DEFAULT, "status": 502, "params": set()})


def _is_errors_target(node):
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    return any("error" in ast.unparse(t).lower() or ast.unparse(t) in ("fields", "reason") for t in targets)


def _collect_texts(node, found, messages):
    """Every sentence-like literal inside a field-error expression is a validation message."""
    for sub in ast.walk(node):
        if isinstance(sub, (ast.Constant, ast.JoinedStr)):
            text, params = _text(sub)
            if text and " " in text and text[0].isupper() and text.rstrip()[-1] in ".?!":
                _note(found, messages, "validation_error", text, 400, params)


def _note(found, messages, code, message, status, params):
    row = found.setdefault(code, {"message": message, "status": status, "params": set()})
    if row["message"] is None:
        row["message"] = message
    row["params"].update(params)
    messages[(code, message)] = sorted(set(params))


def build():
    found, messages, dynamic = scan()
    for message in FRAMEWORK_MESSAGES:
        messages[("validation_error", message)] = sorted(set(re.findall(r"\{(\w+)\}", message)))
    for code, (message, status, params) in EXTRA_CODES.items():
        row = found.setdefault(code, {"message": message, "status": status, "params": set()})
        row["message"], row["status"] = message, status
        row["params"].update(params)
        messages[(code, message)] = sorted(set(params))
    for code, row in found.items():
        if row["message"] is None:
            row["message"] = "Something went wrong. Please try again."
    return found, messages, dynamic


def render(found, messages, dynamic):
    lines = [
        '"""Every error code the API can answer, with its plain-English default, HTTP status and parameter names.',
        "",
        "Generated by scripts/extract_error_codes.py: run it after adding or changing an error, never edit by hand.",
        "ERROR_CODES: code -> English default, status and the {params} its text may use.",
        "ERROR_MESSAGES: every literal (code, English message) the code base raises; each has an Arabic text in locale_ar.",
        "DYNAMIC: raise sites whose code or message is built at run time (reviewed by hand).",
        '"""',
        "",
        "ERROR_CODES = {",
    ]
    for code in sorted(found):
        row = found[code]
        lines.append(f"    {code!r}: {{\"message\": {row['message']!r}, \"status\": {row['status']}, \"params\": {sorted(row['params'])!r}}},")
    lines.append("}")
    lines.append("")
    lines.append("ERROR_MESSAGES = [")
    for (code, message) in sorted(messages):
        lines.append(f"    ({code!r}, {message!r}),")
    lines.append("]")
    lines.append("")
    lines.append("DYNAMIC = [")
    for d in sorted(dynamic):
        lines.append(f"    {d!r},")
    lines.append("]")
    lines.append("")
    return "\n".join(lines)


def main():
    found, messages, dynamic = build()
    text = render(found, messages, dynamic)
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print("ilaf/error_codes.py is out of date: run python scripts/extract_error_codes.py")
            return 1
        return 0
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"{len(found)} codes, {len(messages)} messages, {len(dynamic)} dynamic sites -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
