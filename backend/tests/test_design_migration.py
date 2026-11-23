"""The legacy design converter and the data migrations that use it."""
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase, TransactionTestCase

from ilaf.design import validate_design
from ilaf.legacy import convert_legacy_design, convert_v2_design

BEFORE = [("cards", "0002_design_v2_fields"), ("workspaces", "0002_design_v2_fields")]
AFTER = [("cards", "0003_design_v2_data"), ("workspaces", "0003_design_v2_data")]


class ConverterTests(SimpleTestCase):
    def test_layout_mapping(self):
        mapping = {
            "classic": "classic", "left": "edge", "banner": "bands", "minimal": "swiss", "grid": "split",
            "icons": "orbit", "floating": "frame", "poster": "magazine", "duo": "stack", "linkbio": "portrait",
        }
        for layout, face in mapping.items():
            new = convert_legacy_design({"layout": layout, "acc": "#112233", "bg": "#ffffff", "fg": "#000000"})
            self.assertEqual(new["face"], face)
            validate_design(convert_v2_design(new))  # the result converts to a valid current design

    def test_colours_details_intro_photo(self):
        new = convert_legacy_design(
            {"layout": "poster", "bg": "#fff", "fg": "#000000", "acc": "#ff5a1f", "brand_colors": True, "foot": False}
        )
        self.assertEqual(new["bg"], "#ffffff")
        self.assertEqual(new["bg2"], "#e6e6e6")  # 10% of the way from white to black
        self.assertEqual(new["fg"], "#000000")
        self.assertEqual(new["acc"], "#ff5a1f")
        self.assertEqual((new["details"], new["intro"], new["photo"]), ("list", "fade-up", True))
        self.assertIs(new["brand_colors"], True)
        self.assertIs(new["foot"], False)
        for key in ("layout", "bgm", "font", "btn", "shape", "cover", "addr", "acts"):
            self.assertNotIn(key, new)

    def test_on_colour_is_black_or_white_by_contrast(self):
        self.assertEqual(convert_legacy_design({"acc": "#ffe14d"})["on"], "#000000")
        self.assertEqual(convert_legacy_design({"acc": "#102a6b"})["on"], "#ffffff")

    def test_missing_values_fall_back(self):
        new = convert_legacy_design({})
        self.assertEqual((new["face"], new["acc"]), ("classic", "#ff5a1f"))


class MigrationTests(TransactionTestCase):
    def _apps(self, targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        executor = MigrationExecutor(connection)
        return executor.loader.project_state(targets).apps

    def test_data_migration_converts_cards_and_brands_and_reverses(self):
        apps = self._apps(BEFORE)
        old = {"layout": "banner", "acc": "#ff0000", "bg": "#101010", "fg": "#f0f0f0", "bgm": "mesh", "font": "serif"}
        ws = apps.get_model("workspaces", "Workspace").objects.create(
            kind="company", name="Co", brand={"company_name": "Co", "design": old}
        )
        card = apps.get_model("cards", "Card").objects.create(workspace=ws, public_code="abcdefghjk", design=old)

        apps = self._apps(AFTER)
        card = apps.get_model("cards", "Card").objects.get(pk=card.pk)
        ws = apps.get_model("workspaces", "Workspace").objects.get(pk=ws.pk)
        self.assertEqual(card.design["face"], "bands")
        self.assertEqual(ws.brand["design"]["face"], "bands")
        self.assertEqual(card.design["bg"], "#101010")
        self.assertEqual(card.design["bg2"], "#262626")
        self.assertEqual(card.design["on"], "#000000")  # black has the higher contrast on pure red
        self.assertEqual(card.legacy_design, old)
        self.assertEqual(ws.legacy_brand_design, old)
        validate_design(convert_v2_design(card.design))

        apps = self._apps(BEFORE)  # reverse restores the old JSON
        self.assertEqual(apps.get_model("cards", "Card").objects.get(pk=card.pk).design, old)
        self.assertEqual(apps.get_model("workspaces", "Workspace").objects.get(pk=ws.pk).brand["design"], old)

        executor = MigrationExecutor(connection)  # leave the database fully migrated for later tests
        executor.migrate(executor.loader.graph.leaf_nodes())


class NumberedDesignTests(TransactionTestCase):
    def test_named_faces_map_to_their_library_numbers(self):
        new = convert_v2_design({"face": "magazine", "details": "bento", "intro": "curtain", "photo": False, "acc": "#123456"})
        self.assertEqual(new, {"face": 14, "colour": 0, "below": 8, "intro": 16, "photo": False, "brand_colors": False, "foot": True})
        self.assertEqual(convert_v2_design({"intro": "none"})["intro"], 0)
        self.assertEqual(convert_v2_design({"layout": "banner"})["face"], 9)  # the oldest layout design too
        self.assertEqual(convert_v2_design(None)["face"], 1)
        validate_design(convert_v2_design({"face": "ribbon", "details": "accordion", "intro": "ripple"}))

    def test_numbered_data_migration(self):
        mid = [("cards", "0003_design_v2_data"), ("workspaces", "0003_design_v2_data")]
        MigrationExecutor(connection).migrate(mid)
        apps = MigrationExecutor(connection).loader.project_state(mid).apps
        old = {"face": "orbit", "details": "dock", "intro": "door", "bg": "#fff", "photo": True}
        ws = apps.get_model("workspaces", "Workspace").objects.create(kind="company", name="Co", brand={"design": old})
        card = apps.get_model("cards", "Card").objects.create(workspace=ws, public_code="abcdefghjk", design=old)
        executor = MigrationExecutor(connection)
        leaves = executor.loader.graph.leaf_nodes()
        executor.migrate(leaves)
        apps = MigrationExecutor(connection).loader.project_state(leaves).apps
        card = apps.get_model("cards", "Card").objects.get(pk=card.pk)
        ws = apps.get_model("workspaces", "Workspace").objects.get(pk=ws.pk)
        self.assertEqual((card.design["face"], card.design["below"], card.design["intro"]), (21, 9, 17))
        self.assertEqual(ws.brand["design"]["face"], 21)
        self.assertEqual(card.legacy_design, old)
