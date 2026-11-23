"""Guide progress: sign-in needed, one person's rows are private, input is validated, a thumb can change."""
from rest_framework.test import APIClient

from guide.models import GuideProgress

from .base import API, ApiTestCase

URL = API + "guide/progress"


class GuideProgressTests(ApiTestCase):
    def test_needs_sign_in(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)
        self.assertEqual(APIClient().put(URL, {"guide_id": "a", "step_id": "b", "state": "done"}, format="json").status_code, 401)

    def test_empty_then_saved_and_updated(self):
        alice = self.signup()
        self.assertEqual(alice.client.get(URL).data, {"items": []})
        res = alice.client.put(URL, {"guide_id": "personal", "step_id": "add-photo", "state": "done"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["items"][0]["state"], "done")
        alice.client.put(URL, {"guide_id": "personal", "step_id": "add-photo", "state": "skipped"}, format="json")
        items = alice.client.get(URL).data["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["state"], "skipped")

    def test_rows_are_private_to_each_person(self):
        alice = self.signup()
        bob = self.signup("bob@example.com", "Bob Brown")
        alice.client.put(URL, {"guide_id": "welcome", "step_id": "audience-personal", "state": "done"}, format="json")
        self.assertEqual(bob.client.get(URL).data["items"], [])
        bob.client.put(URL, {"guide_id": "welcome", "step_id": "audience-personal", "state": "dismissed"}, format="json")
        self.assertEqual(GuideProgress.objects.count(), 2)
        self.assertEqual(alice.client.get(URL).data["items"][0]["state"], "done")

    def test_reset_removes_the_row(self):
        alice = self.signup()
        alice.client.put(URL, {"guide_id": "welcome", "step_id": "seen", "state": "dismissed"}, format="json")
        alice.client.put(URL, {"guide_id": "welcome", "step_id": "seen", "state": "reset"}, format="json")
        self.assertEqual(alice.client.get(URL).data["items"], [])

    def test_several_at_once(self):
        alice = self.signup()
        res = alice.client.put(URL, {"items": [
            {"guide_id": "next", "step_id": "card-published", "state": "shown"},
            {"guide_id": "help", "step_id": "publish-and-share", "state": "up"},
        ]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(alice.client.get(URL).data["items"]), 2)

    def test_validation(self):
        alice = self.signup()
        bad = [
            {"guide_id": "Bad Id", "step_id": "x", "state": "done"},
            {"guide_id": "a", "step_id": "", "state": "done"},
            {"guide_id": "a", "step_id": "x" * 65, "state": "done"},
            {"guide_id": "a", "step_id": "x", "state": "finished"},
            {"guide_id": 5, "step_id": "x", "state": "done"},
            {"step_id": "x", "state": "done"},
        ]
        for item in bad:
            res = alice.client.put(URL, item, format="json")
            self.assertEqual(res.status_code, 400, item)
            self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertEqual(alice.client.put(URL, {"items": []}, format="json").status_code, 400)
        self.assertEqual(alice.client.put(URL, {"items": "no"}, format="json").status_code, 400)
        self.assertEqual(GuideProgress.objects.count(), 0)

    def test_row_cap(self):
        alice = self.signup()
        from accounts.models import User

        user = User.objects.get(email=alice.email)
        GuideProgress.objects.bulk_create(
            [GuideProgress(user=user, guide_id="g", step_id=f"s{i}", state="done") for i in range(600)]
        )
        res = alice.client.put(URL, {"guide_id": "g", "step_id": "one-more", "state": "done"}, format="json")
        self.assertEqual(res.status_code, 400)
        # Changing an existing row is still allowed.
        self.assertEqual(alice.client.put(URL, {"guide_id": "g", "step_id": "s1", "state": "skipped"}, format="json").status_code, 200)


class GuideArabicTests(ApiTestCase):
    def test_errors_speak_arabic_and_carry_codes(self):
        from guide.views import clean  # noqa: F401  (the messages below are the ones it raises)

        alice = self.signup()
        res = alice.client.put(URL, {"items": []}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["message"], "أرسل ما بين إدخال واحد و20 إدخالاً.")
        res = alice.client.put(URL, {"guide_id": "a", "step_id": "b", "state": "nope"}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertEqual(res.data["error"]["fields"]["state"], ["اختر حالة صالحة."])

    def test_row_cap_has_its_own_code(self):
        from accounts.models import User

        alice = self.signup()
        user = User.objects.get(email=alice.email)
        GuideProgress.objects.bulk_create(
            [GuideProgress(user=user, guide_id="g", step_id=f"s{i}", state="done") for i in range(600)]
        )
        res = alice.client.put(URL, {"guide_id": "g", "step_id": "extra", "state": "done"}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.data["error"]["code"], "guide_limit")
        self.assertEqual(res.data["error"]["message"], "عدد إدخالات الدليل المحفوظة كبير جداً.")
