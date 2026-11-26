"""Booking: the owner's hours, the free slots a visitor sees, taking a slot, and the owner's list."""
from datetime import datetime, timezone as dt_tz
from unittest.mock import patch

from django.core import mail
from rest_framework.test import APIClient

from cards.models import Booking
from leads.models import Lead

from .base import API, ApiTestCase

# A Monday morning: 06:00 UTC is 09:00 in Qatar, so the 09:00 slot of that day has just started.
NOW = datetime(2027, 1, 4, 6, 0, tzinfo=dt_tz.utc)
EVERY_DAY = [{"d": d, "from": "09:00", "to": "11:00"} for d in range(7)]


class BookingCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("owner@example.com", "Olivia Owner")
        self.buy(self.person, "business")
        self.card = self.published_card(self.person)
        self.settings_url = f"{API}cards/{self.card['id']}/booking-settings"
        self.public = f"{API}public/cards/{self.card['public_code']}"
        self.set_hours()
        self.clock = patch("cards.booking_slots.now", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        mail.outbox.clear()

    def set_hours(self, **overrides):
        payload = {"enabled": True, "timezone": "Asia/Qatar", "slot_minutes": 30, "buffer_minutes": 0, "days_ahead": 14, "weekly": EVERY_DAY, **overrides}
        res = self.person.client.put(self.settings_url, payload, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def availability(self, **params):
        res = APIClient().get(f"{self.public}/availability", params)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def book(self, date="2027-01-05", time="09:30", **extra):
        payload = {"date": date, "time": time, "name": "Visitor Vera", "email": "vera@example.com", "phone": "5555 1234", "consent": True, **extra}
        return APIClient().post(f"{self.public}/bookings", payload, format="json")


class SettingsTests(BookingCase):
    def test_get_defaults_and_put_round_trip(self):
        other = self.make_card(self.person, name="Other")
        res = self.person.client.get(f"{API}cards/{other['id']}/booking-settings")
        self.assertEqual(res.data, {
            "enabled": False, "timezone": "Asia/Qatar", "slot_minutes": 30, "buffer_minutes": 0, "days_ahead": 14, "weekly": [],
            "location_note": "", "meet_link": "",
        })
        data = self.set_hours(weekly=[{"d": 1, "from": "14:00", "to": "16:00"}, {"d": 1, "from": "09:00", "to": "12:00"}], location_note="Room 4", meet_link="https://meet.example/abc")
        self.assertEqual(data["weekly"], [{"d": 1, "from": "09:00", "to": "12:00"}, {"d": 1, "from": "14:00", "to": "16:00"}])
        self.assertEqual((data["location_note"], data["meet_link"]), ("Room 4", "https://meet.example/abc"))
        self.assertEqual(self.person.client.get(self.settings_url).data, data)

    def test_validation(self):
        res = self.person.client.put(self.settings_url, {
            "timezone": "Mars/Olympus", "slot_minutes": 20, "buffer_minutes": 90, "days_ahead": 3,
            "weekly": [{"d": 1, "from": "09:00", "to": "12:00"}, {"d": 1, "from": "11:00", "to": "13:00"}], "meet_link": "http://plain.example",
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.data["error"]["fields"]), {"timezone", "slot_minutes", "buffer_minutes", "days_ahead", "weekly", "meet_link"})
        self.assertEqual(res.data["error"]["fields"]["weekly"], ["Windows on the same day must not overlap."])
        for weekly, message in (
            ([{"d": 7, "from": "09:00", "to": "10:00"}], "The day must be a number from 0 (Monday) to 6 (Sunday)."),
            ([{"d": 0, "from": "9am", "to": "10:00"}], "Times must be written as HH:MM, for example 09:00."),
            ([{"d": 0, "from": "10:00", "to": "10:00"}], "A window must end after it starts."),
            ("mon-fri", "Send the weekly hours as a list of windows."),
        ):
            res = self.person.client.put(self.settings_url, {"weekly": weekly}, format="json")
            self.assertEqual(res.data["error"]["fields"]["weekly"], [message])


class AvailabilityTests(BookingCase):
    def test_slots_in_qatar_skip_the_slot_that_already_started(self):
        data = self.availability(**{"from": "2027-01-04", "days": 2})
        self.assertEqual((data["timezone"], data["slot_minutes"]), ("Asia/Qatar", 30))
        self.assertEqual(data["days"], [
            {"date": "2027-01-04", "slots": ["09:30", "10:00", "10:30"]},
            {"date": "2027-01-05", "slots": ["09:00", "09:30", "10:00", "10:30"]},
        ])

    def test_defaults_to_today_and_stops_at_the_horizon(self):
        data = self.availability()
        self.assertEqual(len(data["days"]), 14)
        self.assertEqual((data["days"][0]["date"], data["days"][-1]["date"]), ("2027-01-04", "2027-01-17"))
        data = self.availability(**{"from": "2027-01-16", "days": 10})
        self.assertEqual([d["date"] for d in data["days"]], ["2027-01-16", "2027-01-17"])
        self.assertEqual(self.availability(**{"from": "2027-01-01", "days": 2})["days"], [])
        self.assertEqual(APIClient().get(f"{self.public}/availability", {"from": "soon"}).status_code, 400)
        self.assertEqual(APIClient().get(f"{self.public}/availability", {"days": 40}).status_code, 400)

    def test_days_without_a_window_have_no_slots(self):
        self.set_hours(weekly=[{"d": 1, "from": "09:00", "to": "10:00"}])  # Tuesdays only
        data = self.availability(**{"from": "2027-01-05", "days": 2})
        self.assertEqual(data["days"], [{"date": "2027-01-05", "slots": ["09:00", "09:30"]}, {"date": "2027-01-06", "slots": []}])

    def test_booked_slots_and_buffers_disappear(self):
        self.assertEqual(self.book(time="09:30").status_code, 201)
        self.assertEqual(self.availability(**{"from": "2027-01-05", "days": 1})["days"][0]["slots"], ["09:00", "10:00", "10:30"])
        self.set_hours(buffer_minutes=30)
        self.assertEqual(self.availability(**{"from": "2027-01-05", "days": 1})["days"][0]["slots"], ["10:30"])

    def test_zone_with_summer_time_keeps_local_times_and_shifts_utc(self):
        self.set_hours(timezone="Europe/London", days_ahead=90, weekly=[{"d": d, "from": "09:00", "to": "10:00"} for d in range(7)])
        data = self.availability(**{"from": "2027-03-27", "days": 2})
        self.assertEqual(data["days"], [
            {"date": "2027-03-27", "slots": ["09:00", "09:30"]},
            {"date": "2027-03-28", "slots": ["09:00", "09:30"]},
        ])
        winter = self.book(date="2027-03-27", time="09:00", email="w@example.com")
        summer = self.book(date="2027-03-28", time="09:00", email="s@example.com")
        self.assertEqual((winter.status_code, summer.status_code), (201, 201), (winter.content, summer.content))
        self.assertEqual((winter.data["start_at"], winter.data["end_at"]), ("2027-03-27T09:00:00Z", "2027-03-27T09:30:00Z"))
        self.assertEqual((summer.data["start_at"], summer.data["end_at"]), ("2027-03-28T08:00:00Z", "2027-03-28T08:30:00Z"))

    def test_disabled_booking_is_refused(self):
        self.set_hours(enabled=False)
        res = APIClient().get(f"{self.public}/availability")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_off"))
        self.assertEqual(APIClient().get(f"{self.public}/booking").data, {"enabled": False})
        self.set_hours(location_note="Room 4")
        info = APIClient().get(f"{self.public}/booking").data
        self.assertEqual(info, {"enabled": True, "timezone": "Asia/Qatar", "slot_minutes": 30, "days_ahead": 14, "location_note": "Room 4", "meet_link": None})


class PublicBookingTests(BookingCase):
    def test_booking_is_saved_with_lead_bell_and_mails(self):
        res = self.book(note="Please call first")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(set(res.data), {"id", "start_at", "end_at", "status"})
        self.assertEqual((res.data["start_at"], res.data["end_at"], res.data["status"]), ("2027-01-05T06:30:00Z", "2027-01-05T07:00:00Z", "requested"))
        booking = Booking.objects.get()
        self.assertEqual((booking.name, booking.email, booking.phone, booking.note), ("Visitor Vera", "vera@example.com", "5555 1234", "Please call first"))
        self.assertIsNotNone(booking.consented_at)
        lead = Lead.objects.get()
        self.assertEqual((lead.source, lead.email), ("booking", "vera@example.com"))
        self.assertIn("5 Jan 2027, 09:30 (Asia/Qatar)", lead.note)
        recipients = sorted(address for m in mail.outbox for address in m.to)
        self.assertEqual(recipients, ["owner@example.com", "vera@example.com"])
        confirmation = next(m for m in mail.outbox if "vera@example.com" in m.to)
        self.assertIn("09:30", confirmation.body)
        bell = self.person.client.get(f"{API}workspaces/{self.person.ws}/lead-bell").data
        self.assertEqual((bell["unread"], bell["orders"], bell["bookings"]), (1, 0, 1))

    def test_taken_past_and_outside_times_are_refused(self):
        self.assertEqual(self.book(time="09:30").status_code, 201)
        res = self.book(time="09:30")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["time"], ["This time was just taken. Choose another slot."])
        res = self.book(date="2027-01-04", time="09:00")
        self.assertEqual(res.data["error"]["fields"]["time"], ["Choose a time in the future."])
        for date, time in (("2027-01-05", "11:00"), ("2027-01-05", "09:15"), ("2027-01-05", "08:30"), ("2027-02-01", "09:00")):
            res = self.book(date=date, time=time)
            self.assertEqual(res.status_code, 400, (date, time, res.content))
            self.assertEqual(res.data["error"]["fields"]["time"], ["This time is outside the booking hours."], (date, time))
        self.assertEqual(Booking.objects.count(), 1)

    def test_buffer_blocks_the_neighbouring_slots(self):
        self.set_hours(buffer_minutes=15)
        self.assertEqual(self.book(time="09:30").status_code, 201)
        self.assertEqual(self.book(time="10:00").status_code, 400)
        self.assertEqual(self.book(time="09:00").status_code, 400)
        self.assertEqual(self.book(time="10:30").status_code, 201)

    def test_a_cancelled_booking_frees_the_slot(self):
        booking = self.book(time="09:30").data
        Booking.objects.filter(pk=booking["id"]).update(status="cancelled")
        self.assertEqual(self.book(time="09:30").status_code, 201)

    def test_fields_consent_honeypot_and_bad_dates(self):
        res = self.book(name="", email="nope", consent=False)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.data["error"]["fields"]), {"name", "email"})
        res = self.book(consent=False)
        self.assertIn("consent", res.data["error"]["fields"])
        self.assertEqual(self.book(website_url="x").status_code, 201)
        self.assertEqual(Booking.objects.count(), 0)
        self.assertIn("date", self.book(date="tomorrow").data["error"]["fields"])
        self.assertIn("time", self.book(time="9am").data["error"]["fields"])

    def test_disabled_or_draft_card_is_refused(self):
        self.set_hours(enabled=False)
        res = self.book()
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_off"))
        draft = self.make_card(self.person, name="Draft")
        self.assertEqual(APIClient().post(f"{API}public/cards/{draft['public_code']}/bookings", {}, format="json").status_code, 404)

    def test_cancel_by_id_and_email(self):
        booking = self.book().data
        url = f"{API}public/bookings/{booking['id']}/cancel"
        self.assertEqual(APIClient().post(url).status_code, 404)
        self.assertEqual(APIClient().post(url + "?email=other@example.com").status_code, 404)
        mail.outbox.clear()
        res = APIClient().post(url + "?email=VERA@example.com")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data, {"id": booking["id"], "status": "cancelled"})
        self.assertEqual([m.to for m in mail.outbox], [["vera@example.com"]])
        res = APIClient().post(url, {"email": "vera@example.com"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("already closed", res.data["error"]["fields"]["booking"][0])


class OwnerBookingTests(BookingCase):
    def setUp(self):
        super().setUp()
        self.booking_id = self.book().data["id"]
        self.book(date="2027-01-06", time="10:00", email="second@example.com")
        self.base = f"{API}workspaces/{self.person.ws}/bookings"
        mail.outbox.clear()

    def test_list_with_filters(self):
        res = self.person.client.get(self.base)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["count"], 2)
        row = res.data["results"][0]
        self.assertEqual(
            set(row),
            {"id", "card_id", "card_name", "start_at", "end_at", "local_start", "timezone", "name", "email", "phone", "note", "status", "consented_at", "shared_with_company", "created_at"},
        )
        self.assertEqual((row["local_start"], row["timezone"], row["status"]), ("5 Jan 2027, 09:30 (Asia/Qatar)", "Asia/Qatar", "requested"))
        self.assertEqual(self.person.client.get(self.base, {"from": "2027-01-06"}).data["count"], 1)
        self.assertEqual(self.person.client.get(self.base, {"to": "2027-01-05"}).data["count"], 1)
        self.assertEqual(self.person.client.get(self.base, {"status": "confirmed"}).data["count"], 0)
        self.assertEqual(self.person.client.get(self.base, {"card": self.card["id"]}).data["count"], 2)
        stranger = self.signup("stranger@example.com", "Stranger")
        self.assertEqual(stranger.client.get(self.base).status_code, 404)

    def test_confirm_done_and_cancel_rules(self):
        url = f"{self.base}/{self.booking_id}"
        self.assertEqual(self.person.client.patch(url, {"status": "done"}, format="json").status_code, 400)
        res = self.person.client.patch(url, {"status": "confirmed"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "confirmed")
        self.assertEqual([m.to for m in mail.outbox], [["vera@example.com"]])
        self.assertIn("confirmed", mail.outbox[0].subject)
        self.assertEqual(self.person.client.patch(url, {"status": "confirmed"}, format="json").status_code, 400)
        self.assertEqual(self.person.client.patch(url, {"status": "done"}, format="json").data["status"], "done")
        self.assertEqual(self.person.client.patch(url, {"status": "cancelled"}, format="json").status_code, 400)
        self.assertEqual(self.person.client.patch(url, {"status": "lost"}, format="json").status_code, 400)
        self.assertEqual(self.person.client.get(url).data["status"], "done")

    def test_owner_cancel_mails_the_visitor(self):
        res = self.person.client.patch(f"{self.base}/{self.booking_id}", {"status": "cancelled"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("cancelled", mail.outbox[0].subject)
        self.assertEqual(self.availability(**{"from": "2027-01-05", "days": 1})["days"][0]["slots"], ["09:00", "09:30", "10:00", "10:30"])
