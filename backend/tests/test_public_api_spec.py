"""The OpenAPI document: it is served without a key, it is structurally valid, and it matches the real routes and scopes."""
import re

from django.urls import get_resolver
from rest_framework.test import APIClient

from publicapi import spec
from publicapi.base import PublicApiView
from publicapi.models import SCOPES

from .base import ApiTestCase

URL = "/api/public/v1/openapi.json"
METHODS = {"get", "post", "patch", "delete", "put"}


def real_routes():
    """{(method, '/path/{param}'): scope} read from the URL configuration and each view's `required_scopes`."""
    out = {}
    for pattern in get_resolver().url_patterns:
        if "api/public/v1/" not in str(pattern.pattern):
            continue
        for sub in pattern.url_patterns:
            view = sub.callback.view_class
            if not issubclass(view, PublicApiView):
                continue
            path = "/" + re.sub(r"<uuid:(\w+)>", r"{\1}", str(sub.pattern))
            for method, scope in view.required_scopes.items():
                out[(method.lower(), path)] = scope
    return out


class OpenApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.doc = APIClient().get(URL).data

    def test_served_without_a_key(self):
        res = APIClient().get(URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.doc["openapi"], "3.1.0")

    def test_required_top_level_fields(self):
        for field in ("openapi", "info", "paths", "components"):
            self.assertIn(field, self.doc)
        self.assertTrue(self.doc["info"]["title"])
        self.assertTrue(self.doc["info"]["version"])
        self.assertIn("bearerAuth", self.doc["components"]["securitySchemes"])
        self.assertTrue(self.doc["servers"][0]["url"].endswith("/api/public/v1"))

    def test_the_product_name_comes_from_settings(self):
        from django.test import override_settings

        with override_settings(PRODUCT_NAME="Acme Cards"):
            doc = APIClient().get(URL).data
        self.assertEqual(doc["info"]["title"], "Acme Cards Public API")

    def test_every_operation_is_complete(self):
        seen_ids = set()
        for path, item in self.doc["paths"].items():
            for method, op in item.items():
                self.assertIn(method, METHODS)
                for field in ("operationId", "summary", "responses", "tags", "security"):
                    self.assertIn(field, op, f"{method} {path}")
                self.assertNotIn(op["operationId"], seen_ids)
                seen_ids.add(op["operationId"])
                self.assertTrue(any(code.startswith("2") for code in op["responses"]), f"{method} {path}")
                self.assertIn("401", op["responses"])
                for name in re.findall(r"{(\w+)}", path):
                    declared = [p for p in op["parameters"] if p.get("name") == name and p["in"] == "path"]
                    self.assertTrue(declared and declared[0]["required"], f"{method} {path} {name}")
                if method in ("post", "patch") and "requestBody" in op:
                    self.assertTrue(op["requestBody"]["content"]["application/json"]["schema"])

    def test_every_reference_resolves(self):
        text = str(self.doc)
        names = set(re.findall(r"#/components/(\w+)/(\w+)", text))
        for kind, name in names:
            self.assertIn(name, self.doc["components"][kind], f"{kind}/{name}")

    def test_routes_and_scopes_match_the_code(self):
        documented = {}
        for path, item in self.doc["paths"].items():
            for method, op in item.items():
                documented[(method, path)] = op["x-required-scope"]
        real = real_routes()
        real.pop(("get", "/openapi.json"), None)
        self.assertEqual(set(documented), set(real), "the document and the URL configuration list different routes")
        for key, scope in real.items():
            self.assertEqual(documented[key], scope, key)

    def test_every_scope_is_used_and_described(self):
        used = {op["x-required-scope"] for item in self.doc["paths"].values() for op in item.values()}
        for scope in SCOPES:
            self.assertIn(scope, used, scope)
            self.assertIn(scope, self.doc["x-scopes"])

    def test_error_and_paging_shapes(self):
        error = self.doc["components"]["schemas"]["Error"]
        self.assertEqual(error["required"], ["error"])
        self.assertEqual(self.doc["components"]["schemas"]["LeadPage"]["required"], ["data", "has_more", "next_cursor"])

    def test_changelog_is_listed(self):
        self.assertEqual(self.doc["info"]["x-changelog"][0]["version"], "v1")
