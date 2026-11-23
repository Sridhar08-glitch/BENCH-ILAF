"""The country of a company: the list, creating and changing it, the staff screens and the analytics 'by country'."""
from analytics.models import Event
from ilaf.countries import COUNTRIES, country_name, country_or_none
from ilaf.i18n import translate_message
from workspaces.models import Workspace

from .base import API
from .bo_base import BackOfficeCase


class CountryListTests(BackOfficeCase):
    def test_the_list_has_both_languages_and_checks_codes(self):
        self.assertGreaterEqual(len(COUNTRIES), 240)
        for code, names in COUNTRIES.items():
            self.assertEqual(len(code), 2, code)
            self.assertTrue(names["en"] and names["ar"], code)
        self.assertEqual(country_name("qa"), "Qatar")
        self.assertEqual(country_name("QA", "ar"), "قطر")
        self.assertEqual(country_or_none(" qa "), "QA")
        self.assertEqual(country_or_none(""), "")
        self.assertEqual(country_or_none(None), "")
        self.assertIsNone(country_or_none("ZZ"))
        self.assertIsNone(country_or_none("Qatar"))


class CompanyCountryApiTests(BackOfficeCase):
    def test_create_with_and_without_a_country(self):
        res = self.owner.client.post(API + "workspaces", {"name": "Gulf Ltd", "country": "qa"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["country"], "QA")
        plain = self.owner.client.post(API + "workspaces", {"name": "Plain Ltd"}, format="json")
        self.assertEqual(plain.status_code, 201)
        self.assertIsNone(plain.data["country"])
        bad = self.owner.client.post(API + "workspaces", {"name": "Bad Ltd", "country": "XX"}, format="json")
        self.assertEqual((bad.status_code, bad.json()["error"]["code"]), (400, "validation_error"))
        self.assertIn("country", bad.json()["error"]["fields"])

    def test_existing_companies_have_no_country_until_one_is_chosen(self):
        got = self.owner.client.get(f"{API}workspaces/{self.ws}")
        self.assertIsNone(got.data["country"])
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"country": "AE"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["country"], "AE")
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}").data["country"], "AE")
        cleared = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"country": ""}, format="json")
        self.assertIsNone(cleared.data["country"])

    def test_a_bad_code_is_refused_in_english_and_arabic(self):
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"country": "Narnia"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"]["fields"]["country"], ["Choose a country from the list."])
        self.assertEqual(translate_message("ar", "Choose a country from the list."), "اختر دولة من القائمة.")
        self.assertEqual(translate_message("ar", "The country is only available on company workspaces."), "الدولة متاحة لمساحات الشركات فقط.")

    def test_the_change_is_logged_and_the_personal_space_has_no_country(self):
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"country": "QA"}, format="json")
        log = self.owner.client.get(f"{API}workspaces/{self.ws}/audit").json()
        text = str(log)
        self.assertIn("country", text)
        personal = self.owner.client.get(API + "me/workspaces").data
        pid = next(w["id"] for w in personal if w["kind"] == "personal")
        res = self.owner.client.patch(f"{API}workspaces/{pid}", {"country": "QA"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_an_employee_cannot_change_it(self):
        member = self.invite(self.owner, self.ws, "eve@acme.test")
        staffer = self.join(member)
        res = staffer.client.patch(f"{API}workspaces/{self.ws}", {"country": "QA"}, format="json")
        self.assertIn(res.status_code, (403, 404))
        self.assertIsNone(Workspace.objects.get(pk=self.ws).country)


class StaffCountryTests(BackOfficeCase):
    def test_staff_list_and_detail_show_the_company_country(self):
        listing = self.ro.client.get(self.url("companies")).data["results"][0]
        self.assertEqual(listing["country"], "")
        Workspace.objects.filter(pk=self.ws).update(country="QA")
        listing = self.ro.client.get(self.url("companies")).data["results"][0]
        self.assertEqual(listing["country"], "QA")
        detail = self.ro.client.get(self.url(f"companies/{self.ws}")).data
        self.assertEqual((detail["country"], detail["country_guessed"]), ("QA", False))

    def test_detail_falls_back_to_the_visitor_guess_and_says_so(self):
        Event.objects.create(card_id=self.card["id"], type="view", country="EG")
        detail = self.ro.client.get(self.url(f"companies/{self.ws}")).data
        self.assertEqual((detail["country"], detail["country_guessed"]), ("EG", True))
        Workspace.objects.filter(pk=self.ws).update(country="QA")
        detail = self.ro.client.get(self.url(f"companies/{self.ws}")).data
        self.assertEqual((detail["country"], detail["country_guessed"]), ("QA", False))

    def test_analytics_counts_companies_by_their_own_country_first(self):
        Event.objects.create(card_id=self.card["id"], type="view", country="EG")
        rows = self.ro.client.get(self.url("analytics")).data["company_countries"]
        self.assertEqual(rows, [{"country": "EG", "companies": 1, "guessed": 1}])
        Workspace.objects.filter(pk=self.ws).update(country="QA")
        rows = self.ro.client.get(self.url("analytics")).data["company_countries"]
        self.assertEqual(rows, [{"country": "QA", "companies": 1, "guessed": 0}])
        # the visitor views stay as they were
        self.assertEqual(self.ro.client.get(self.url("analytics")).data["countries"][0]["country"], "EG")

    def test_an_announcement_for_a_country_uses_the_own_country(self):
        from staff.ops_services import company_country

        Event.objects.create(card_id=self.card["id"], type="view", country="EG")
        ws = Workspace.objects.get(pk=self.ws)
        self.assertEqual(company_country(ws), "EG")
        ws.country = "QA"
        self.assertEqual(company_country(ws), "QA")
