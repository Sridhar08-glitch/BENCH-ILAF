from django.test import TestCase


class HealthTests(TestCase):
    def test_health_answers_without_login(self):
        res = self.client.get("/health/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "ok", "database": "ok"})

    def test_health_is_get_only_and_not_cached(self):
        self.assertEqual(self.client.post("/health/").status_code, 405)
        self.assertIn("no-cache", self.client.get("/health/")["Cache-Control"])
