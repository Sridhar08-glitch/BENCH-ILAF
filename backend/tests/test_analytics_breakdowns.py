"""Analytics by person, department, button and source; date ranges, time zones and who may see what."""
from datetime import datetime, timedelta, timezone as dt_tz

from django.utils import timezone

from analytics.models import Event
from cards.models import Card
from leads.models import Lead

from .base import API
from .ops_base import OpsTestCase


def at(days_ago, hour=12):
    base = timezone.now().astimezone(dt_tz.utc).replace(hour=hour, minute=0, second=0, microsecond=0)
    return base - timedelta(days=days_ago)


class BreakdownCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.sales = self.department("Sales")
        self.support = self.department("Support")
        self.eve = self.add("eve@example.com", "Eve Employee", department_id=self.sales["id"])
        self.sam = self.add("sam@example.com", "Sam Seller", department_id=self.sales["id"])
        self.sue = self.add("sue@example.com", "Sue Support", department_id=self.support["id"])
        self.cards = {n: Card.objects.get(pk=getattr(self, n).card_id) for n in ("eve", "sam", "sue")}

    def ev(self, who, type_="view", when=None, **kw):
        card = self.cards[who]
        e = Event.objects.create(card=card, type=type_, **kw)
        Event.objects.filter(pk=e.pk).update(created_at=when or at(1))
        return e

    def lead(self, who, when=None, **kw):
        card = self.cards[who]
        lead = Lead.objects.create(card=card, workspace_id=self.ws, name="L", **kw)
        Lead.objects.filter(pk=lead.pk).update(created_at=when or at(1))
        return lead

    def get(self, name, client=None, **params):
        res = (client or self.owner.client).get(self.url(f"analytics/{name}" if name else "analytics"), params)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data


class PeopleTests(BreakdownCase):
    def test_rows_per_person_with_previous_period_and_department(self):
        for _ in range(5):
            self.ev("eve")
        for _ in range(2):
            self.ev("eve", when=at(10))  # previous period of a 7-day range
        self.ev("eve", "save")
        self.ev("eve", "view", source="qr")
        self.ev("sam", "link_click", kind="WhatsApp")
        self.lead("eve")
        data = self.get("people", days=7)
        rows = {r["name"]: r for r in data["rows"]}
        eve = rows["Eve Employee"]
        self.assertEqual((eve["totals"]["views"], eve["totals"]["scans"], eve["totals"]["saves"], eve["totals"]["leads"]), (6, 1, 1, 1))
        self.assertEqual(eve["prev"]["views"], 2)
        self.assertEqual(eve["department"], "Sales")
        self.assertEqual(rows["Sam Seller"]["totals"]["link_clicks"], 1)
        self.assertEqual(data["rows"][0]["name"], "Eve Employee")  # most views first
        self.assertEqual(data["totals"]["views"], 6)
        self.assertEqual(data["period"]["days"], 7)

    def test_by_card(self):
        self.ev("eve")
        data = self.get("people", by="card", days=7)
        self.assertEqual(data["by"], "card")
        self.assertTrue(all(len(r["card_ids"]) == 1 for r in data["rows"]))

    def test_employee_sees_only_their_own_numbers(self):
        self.ev("eve")
        self.ev("sam")
        data = self.get("people", client=self.eve.client, days=7)
        self.assertEqual([r["name"] for r in data["rows"]], ["Eve Employee"])
        self.assertEqual(data["totals"]["views"], 1)

    def test_events_outside_the_range_are_ignored(self):
        self.ev("eve", when=at(40))
        self.assertEqual(self.get("people", days=7)["totals"]["views"], 0)
        self.assertEqual(self.get("people", days=60)["totals"]["views"], 1)

    def test_explicit_from_and_to(self):
        self.ev("eve", when=at(3))
        day = lambda n: at(n).date().isoformat()
        self.assertEqual(self.get("people", **{"from": day(4), "to": day(2)})["totals"]["views"], 1)
        self.assertEqual(self.get("people", **{"from": day(10), "to": day(5)})["totals"]["views"], 0)

    def test_bad_ranges(self):
        for params in ({"from": "x"}, {"from": "2026-02-01", "to": "2026-01-01"}, {"from": "2024-01-01", "to": "2026-01-01"},
                       {"days": 0}, {"days": "abc"}, {"tz": "Mars/Base"}):
            res = self.owner.client.get(self.url("analytics/people"), params)
            self.assertEqual(res.status_code, 400, params)


class DepartmentTests(BreakdownCase):
    def test_departments_add_up_people(self):
        for _ in range(3):
            self.ev("eve")
        for _ in range(2):
            self.ev("sam")
        self.ev("sue")
        self.lead("sue")
        data = self.get("departments", days=7)
        rows = {r["name"]: r for r in data["rows"]}
        self.assertEqual(rows["Sales"]["totals"]["views"], 5)
        self.assertEqual(rows["Sales"]["people"], 2)
        self.assertEqual(rows["Sales"]["top_person"], {"name": "Eve Employee", "views": 3})
        self.assertEqual((rows["Support"]["totals"]["views"], rows["Support"]["totals"]["leads"]), (1, 1))
        self.assertNotIn("No department", rows)
        self.assertEqual(data["rows"][0]["name"], "Sales")

    def test_people_without_a_department_get_their_own_row(self):
        nate = self.add("nate@example.com", "Nate NoDept")
        Event.objects.create(card=Card.objects.get(pk=nate.card_id), type="view")
        rows = {r["name"]: r for r in self.get("departments", days=7)["rows"]}
        self.assertEqual(rows["No department"]["totals"]["views"], 1)

    def test_empty_department_still_listed(self):
        self.department("Marketing")
        self.assertIn("Marketing", [r["name"] for r in self.get("departments")["rows"]])

    def test_employees_cannot_open_it(self):
        self.assertEqual(self.eve.client.get(self.url("analytics/departments")).status_code, 403)

    def test_other_companies_data_never_appears(self):
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Ltd")
        res = other.client.get(f"{API}workspaces/{other_ws}/analytics/departments")
        self.assertEqual(res.data["totals"]["views"], 0)
        self.assertEqual(res.data["rows"], [])
        self.assertEqual(other.client.get(f"{API}workspaces/{self.ws}/analytics/people").status_code, 404)


class LinksAndSourcesTests(BreakdownCase):
    def test_link_leaderboard(self):
        for _ in range(3):
            self.ev("eve", "link_click", kind="WhatsApp", visitor_hash="a")
        self.ev("sam", "link_click", kind="WhatsApp", visitor_hash="b")
        self.ev("sam", "link_click", kind="Phone")
        self.ev("eve", "link_click", kind="Phone", when=at(10))
        data = self.get("links", days=7)
        self.assertEqual(data["total"], 5)
        wa = data["rows"][0]
        self.assertEqual((wa["kind"], wa["clicks"], wa["visitors"], wa["share"]), ("WhatsApp", 4, 2, 80.0))
        self.assertEqual(wa["top_card"]["clicks"], 3)
        phone = data["rows"][1]
        self.assertEqual((phone["clicks"], phone["prev_clicks"]), (1, 1))

    def test_employee_links_are_scoped(self):
        self.ev("sam", "link_click", kind="Phone")
        self.assertEqual(self.get("links", client=self.eve.client, days=7)["total"], 0)

    def test_sources_with_series_and_lead_channels(self):
        self.ev("eve", source="qr")
        self.ev("eve", source="qr")
        self.ev("eve", source="nfc")
        self.ev("eve", source="link")
        self.ev("eve", source="weird")
        self.ev("eve", source="qr", when=at(10))
        self.lead("eve", channel="qr")
        self.lead("eve", channel="")
        data = self.get("sources", days=7)
        rows = {r["key"]: r for r in data["rows"]}
        self.assertEqual((rows["qr"]["views"], rows["qr"]["prev_views"], rows["qr"]["leads"]), (2, 1, 1))
        self.assertEqual(rows["other"]["views"], 1)
        self.assertEqual(data["total"], 5)
        self.assertEqual(rows["qr"]["share"], 40.0)
        self.assertEqual(len(data["series"]), 7)
        self.assertEqual(sum(d["qr"] for d in data["series"]), 2)


class OverviewTests(BreakdownCase):
    def test_old_shape_is_kept_and_period_added(self):
        self.ev("eve")
        data = self.get("", days=7)
        for key in ("totals", "prev_totals", "series", "sources", "locations", "devices", "hours", "top_buttons", "cards"):
            self.assertIn(key, data)
        self.assertEqual(len(data["series"]), 7)
        self.assertEqual(data["period"]["group"], "day")

    def test_week_and_month_buckets(self):
        for d in (1, 2, 20, 50):
            self.ev("eve", when=at(d))
        weeks = self.get("", days=90, group="week")["series"]
        self.assertEqual(sum(w["views"] for w in weeks), 4)
        self.assertTrue(all(datetime.fromisoformat(w["date"]).weekday() == 0 for w in weeks))
        months = self.get("", days=90, group="month")["series"]
        self.assertEqual(sum(m["views"] for m in months), 4)
        self.assertTrue(all(m["date"].endswith("-01") for m in months))
        self.assertEqual(self.owner.client.get(self.url("analytics"), {"group": "year"}).status_code, 400)

    def test_time_zone_moves_the_day_boundary(self):
        late = at(1, hour=23).replace(minute=30)  # 23:30 UTC is already the next day in Qatar (UTC+3)
        self.ev("eve", when=late)
        utc = {r["date"]: r["views"] for r in self.get("", days=7, tz="UTC")["series"]}
        doha = {r["date"]: r["views"] for r in self.get("", days=7, tz="Asia/Qatar")["series"]}
        self.assertEqual(utc[late.date().isoformat()], 1)
        self.assertEqual(doha[(late.date() + timedelta(days=1)).isoformat()], 1)
        self.assertEqual(doha[late.date().isoformat()], 0)
        hours = self.get("", days=7, tz="Asia/Qatar")["hours"]
        self.assertEqual(hours[2], 1)

    def test_many_events_stay_cheap(self):
        card = self.cards["eve"]
        Event.objects.bulk_create([Event(card=card, type="view", source="qr") for _ in range(600)])
        with self.assertNumQueries(18):
            res = self.owner.client.get(self.url("analytics"), {"days": 30})
        self.assertEqual(res.data["totals"]["views"], 600)
