"""Custom faces: the staff studio, review, approval, publishing, the design key, fallback and company isolation."""
from datetime import timedelta

from django.core import mail
from django.utils import timezone

from cards.models import Card
from designs.models import CustomFace, CustomFacePreview
from designs.starters import STARTERS
from ilaf.branding import contrast_ratio
from operations.models import AuditEvent
from rest_framework.test import APIClient

from .base import API, png_upload
from .staff_base import StaffTestCase


class FaceTestCase(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.admin = self.make_staff("admin@ilaf.test", "admin")
        self.support = self.make_staff("support@ilaf.test", "support")
        self.owner = self.company_with_owner()
        self.rbase = f"{API}workspaces/{self.owner.company}/design-requests"

    def start(self, owner=None, starter="clean"):
        """An open request with a starter face. Returns (request id, face id)."""
        owner = owner or self.owner
        req = self.new_request(owner)
        res = self.admin.client.post(f"{API}staff/design-requests/{req['id']}/faces", {"starter": starter}, format="json")
        assert res.status_code == 201, res.content
        return req["id"], res.data["id"]

    def review(self, rid, fid):
        res = self.admin.client.post(f"{API}staff/faces/{fid}/send-for-review", {}, format="json")
        assert res.status_code == 200, res.content
        return res.data

    def approve(self, owner, rid):
        res = owner.client.post(f"{API}workspaces/{owner.company}/design-requests/{rid}/approve")
        assert res.status_code == 200, res.content

    def go_live(self, owner=None, starter="clean"):
        owner = owner or self.owner
        rid, fid = self.start(owner, starter)
        self.review(rid, fid)
        self.approve(owner, rid)
        res = self.admin.client.post(f"{API}staff/faces/{fid}/publish", {}, format="json")
        assert res.status_code == 200, res.content
        return rid, fid

    def design(self, **extra):
        return {"design": extra}

    def own_card(self, owner=None):
        owner = owner or self.owner
        res = owner.client.post(f"{API}workspaces/{owner.company}/cards", {"name": "Olivia Owner", "title": "CEO"}, format="json")
        assert res.status_code == 201, res.content
        return res.data

    def set_card_design(self, owner, card, **design):
        return owner.client.patch(f"{API}cards/{card['id']}", {"design": design}, format="json")


class WorkflowTests(FaceTestCase):
    def test_whole_flow_from_request_to_live_face(self):
        rid, fid = self.start()
        detail = self.owner.client.get(f"{self.rbase}/{rid}").data
        self.assertEqual(detail["status"], "in_design")
        self.assertEqual(detail["face"], {"id": fid, "name": "Clean, left aligned", "status": "draft"})
        self.assertFalse(detail["can_review"])
        # staff edit the CSS in the studio
        studio = self.admin.client.get(f"{API}staff/faces/{fid}").data
        self.assertEqual(studio["status"], "draft")
        self.assertEqual(studio["version"], 1)
        self.assertEqual(len(studio["palettes"]), 4)
        css = studio["css"].replace("font-size:7cqw", "font-size:6cqw")
        saved = self.admin.client.patch(f"{API}staff/faces/{fid}", {"css": css}, format="json")
        self.assertEqual(saved.status_code, 200)
        self.assertIn("font-size:6cqw", saved.data["css"])
        # review: a private link and a mail to the company
        mail.outbox.clear()
        out = self.review(rid, fid)
        self.assertRegex(out["preview_url"], r"^https://web\.test/preview/custom/[A-Za-z0-9_-]{30,}$")
        self.assertEqual(self.owner.client.get(f"{self.rbase}/{rid}").data["status"], "in_review")
        self.assertTrue(self.owner.client.get(f"{self.rbase}/{rid}").data["can_review"])
        self.assertTrue(any("ready to review" in m.subject for m in mail.outbox))
        # the link needs no sign-in
        token = out["preview_url"].rsplit("/", 1)[1]
        pub = APIClient().get(f"{API}public/custom-previews/{token}")
        self.assertEqual(pub.status_code, 200)
        self.assertEqual(pub.data["face"]["id"], fid)
        self.assertEqual(pub.data["company"]["name"], "Acme Ltd")
        self.assertIsNone(pub.data["people"])
        self.assertEqual(pub["X-Robots-Tag"], "noindex, nofollow")
        # the owner approves, staff publish
        self.approve(self.owner, rid)
        self.assertEqual(CustomFace.objects.get(pk=fid).status, "approved")
        mail.outbox.clear()
        live = self.admin.client.post(f"{API}staff/faces/{fid}/publish", {}, format="json")
        self.assertEqual(live.data["status"], "live")
        self.assertEqual(self.owner.client.get(f"{self.rbase}/{rid}").data["status"], "live")
        self.assertTrue(any("is live" in m.subject for m in mail.outbox))
        faces = self.owner.client.get(f"{API}workspaces/{self.owner.company}/custom-faces").data
        self.assertEqual([f["id"] for f in faces], [fid])
        self.assertEqual(faces[0]["status"], "live")
        self.assertIn("template", faces[0])
        actions = list(AuditEvent.objects.filter(workspace_id=self.owner.company).values_list("action", flat=True))
        self.assertIn("design_face.live", actions)
        self.assertIn("design_request.approved", actions)

    def test_cannot_publish_before_approval_or_approve_before_review(self):
        rid, fid = self.start()
        self.assertEqual(self.admin.client.post(f"{API}staff/faces/{fid}/publish", {}, format="json").status_code, 409)
        self.assertEqual(self.owner.client.post(f"{self.rbase}/{rid}/approve").status_code, 409)
        self.review(rid, fid)
        self.assertEqual(self.admin.client.post(f"{API}staff/faces/{fid}/publish", {}, format="json").status_code, 409)

    def test_request_changes_sends_the_face_back_to_draft(self):
        rid, fid = self.start()
        self.review(rid, fid)
        self.assertEqual(self.owner.client.post(f"{self.rbase}/{rid}/request-changes", {"comment": ""}, format="json").status_code, 400)
        mail.outbox.clear()
        res = self.owner.client.post(f"{self.rbase}/{rid}/request-changes", {"comment": "Make the name bigger."}, format="json")
        self.assertEqual(res.data["status"], "changes_requested")
        self.assertEqual(CustomFace.objects.get(pk=fid).status, "draft")
        self.assertTrue(any("Make the name bigger." in m.body for m in mail.outbox))
        thread = [m["body"] for m in res.data["messages"] if m["status_to"] == "changes_requested"]
        self.assertEqual(thread, ["Make the name bigger."])
        # staff work on it again and send it back for review
        self.review(rid, fid)
        self.assertEqual(self.owner.client.get(f"{self.rbase}/{rid}").data["status"], "in_review")

    def test_editing_after_approval_asks_for_approval_again(self):
        rid, fid = self.start()
        self.review(rid, fid)
        self.approve(self.owner, rid)
        self.admin.client.patch(f"{API}staff/faces/{fid}", {"css": ".n{color:red}"}, format="json")
        self.assertEqual(CustomFace.objects.get(pk=fid).status, "in_review")
        self.assertEqual(self.owner.client.get(f"{self.rbase}/{rid}").data["status"], "in_review")

    def test_withdraw_sends_face_back_to_draft(self):
        rid, fid = self.start()
        self.review(rid, fid)
        self.owner.client.post(f"{self.rbase}/{rid}/withdraw")
        self.assertEqual(CustomFace.objects.get(pk=fid).status, "draft")

    def test_review_needs_content_and_palettes(self):
        req = self.new_request(self.owner)
        res = self.admin.client.post(f"{API}staff/design-requests/{req['id']}/faces", {}, format="json")
        fid = res.data["id"]
        self.assertEqual(self.admin.client.post(f"{API}staff/faces/{fid}/send-for-review", {}, format="json").status_code, 409)

    def test_customer_preview_inside_the_dashboard(self):
        rid, fid = self.start()
        self.review(rid, fid)
        res = self.owner.client.get(f"{self.rbase}/{rid}/preview")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["face"]["id"], fid)
        self.assertEqual(res.data["company"]["brand"]["company_name"], "Acme Ltd")

    def test_follow_up_request_links_to_the_live_face(self):
        rid, fid = self.go_live()
        res = self.owner.client.post(f"{self.rbase}", {"goals": "Add Arabic support", "follows_face": fid}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["follows_face_id"], fid)
        staff = self.admin.client.get(f"{API}staff/design-requests/{res.data['id']}").data
        self.assertEqual(staff["follows_face_id"], fid)


class PreviewLinkTests(FaceTestCase):
    def link(self, fid):
        res = self.admin.client.post(f"{API}staff/faces/{fid}/previews", {}, format="json")
        self.assertEqual(res.status_code, 201)
        return res.data["preview_url"].rsplit("/", 1)[1], res.data["preview"]["id"]

    def test_token_is_hashed_random_and_expires_in_thirty_days(self):
        rid, fid = self.start()
        token, pid = self.link(fid)
        row = CustomFacePreview.objects.get(pk=pid)
        self.assertNotIn(token, row.token_hash)
        self.assertEqual(len(row.token_hash), 64)
        self.assertAlmostEqual((row.expires_at - timezone.now()).days, 29, delta=1)
        other, _ = self.link(fid)
        self.assertNotEqual(token, other)

    def test_unknown_expired_and_revoked_links_are_404(self):
        rid, fid = self.start()
        token, pid = self.link(fid)
        client = APIClient()
        self.assertEqual(client.get(f"{API}public/custom-previews/{token}").status_code, 200)
        for bad in ("short", "x" * 43, token[:-1] + ("A" if token[-1] != "A" else "B"), "../" + token):
            self.assertEqual(client.get(f"{API}public/custom-previews/{bad}").status_code, 404, bad)
        CustomFacePreview.objects.filter(pk=pid).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(client.get(f"{API}public/custom-previews/{token}").status_code, 404)
        token2, pid2 = self.link(fid)
        self.assertEqual(client.get(f"{API}public/custom-previews/{token2}").status_code, 200)
        self.assertEqual(self.admin.client.post(f"{API}staff/faces/{fid}/previews/{pid2}/revoke", {}, format="json").data["state"], "revoked")
        self.assertEqual(client.get(f"{API}public/custom-previews/{token2}").status_code, 404)

    def test_disabled_face_link_stops_working(self):
        rid, fid = self.start()
        token, _ = self.link(fid)
        self.admin.client.post(f"{API}staff/faces/{fid}/disable", {}, format="json")
        self.assertEqual(APIClient().get(f"{API}public/custom-previews/{token}").status_code, 404)

    def test_view_counter_and_only_staff_admin_can_make_links(self):
        rid, fid = self.start()
        token, pid = self.link(fid)
        for _ in range(2):
            APIClient().get(f"{API}public/custom-previews/{token}")
        self.assertEqual(CustomFacePreview.objects.get(pk=pid).view_count, 2)
        self.assertEqual(self.support.client.post(f"{API}staff/faces/{fid}/previews", {}, format="json").status_code, 403)

    def test_preview_shows_team_names_only_when_the_owner_allowed_it(self):
        rid, fid = self.start()
        token, _ = self.link(fid)
        self.assertIsNone(APIClient().get(f"{API}public/custom-previews/{token}").data["people"])
        DesignRequestAllow = type(CustomFace.objects.get(pk=fid).source_request)
        DesignRequestAllow.objects.filter(pk=rid).update(allow_team_names=True)
        people = APIClient().get(f"{API}public/custom-previews/{token}").data["people"]
        self.assertEqual(people, [{"name": "Olivia Owner", "title": ""}])

    def test_preview_payload_has_no_private_data(self):
        rid, fid = self.start()
        token, _ = self.link(fid)
        body = str(APIClient().get(f"{API}public/custom-previews/{token}").data)
        for secret in ("owner@acme.test", "requested_by", "goals", "A calm dark card"):
            self.assertNotIn(secret, body)


class DesignKeyTests(FaceTestCase):
    def test_choose_a_live_face_and_colourways(self):
        _, fid = self.go_live()
        card = self.own_card()
        for colour in range(5):
            if colour == 4:
                self.assertEqual(self.set_card_design(self.owner, card, custom_face=fid, colour=4).status_code, 400)
                continue
            res = self.set_card_design(self.owner, card, custom_face=fid, colour=colour)
            self.assertEqual(res.status_code, 200, res.content)
            self.assertEqual(res.data["design"]["custom_face"], fid)
            self.assertEqual(res.data["design"]["colour"], colour)

    def test_company_colours_still_work_with_a_custom_face(self):
        _, fid = self.go_live()
        self.owner.client.patch(f"{API}workspaces/{self.owner.company}", {"brand": {"palette": {
            "bg": "#101114", "bg2": "#1b1d22", "fg": "#f6f7f9", "acc": "#ff6b35", "on": "#101114"}}}, format="json")
        card = self.own_card()
        res = self.set_card_design(self.owner, card, custom_face=fid, colour=4)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["design"]["custom_face"], res.data["design"]["colour"]), (fid, 4))

    def test_it_can_be_cleared_and_the_face_key_stays(self):
        _, fid = self.go_live()
        card = self.own_card()
        self.set_card_design(self.owner, card, face=7, custom_face=fid)
        res = self.set_card_design(self.owner, card, custom_face=None)
        self.assertEqual((res.data["design"]["custom_face"], res.data["design"]["face"]), (None, 7))

    def test_bad_values(self):
        card = self.own_card()
        for value in ("5", 0, -3, True, 1.5, [1], {"id": 1}, 987654):
            res = self.set_card_design(self.owner, card, custom_face=value)
            self.assertEqual(res.status_code, 400, value)
            self.assertIn("design.custom_face", res.data["error"]["fields"])

    def test_only_approved_or_live_faces_of_the_same_company(self):
        rid, fid = self.start()
        card = self.own_card()
        for status in ("draft", "in_review", "disabled"):
            CustomFace.objects.filter(pk=fid).update(status=status)
            from designs.services import forget_face

            forget_face(fid)
            self.assertEqual(self.set_card_design(self.owner, card, custom_face=fid).status_code, 400, status)
        for status in ("approved", "live"):
            CustomFace.objects.filter(pk=fid).update(status=status)
            forget_face(fid)
            self.assertEqual(self.set_card_design(self.owner, card, custom_face=fid).status_code, 200, status)

    def test_company_a_can_never_use_company_b_faces(self):
        b = self.company_with_owner("b@bravo.test", "Bravo")
        _, b_face = self.go_live(b)
        card = self.own_card()
        res = self.set_card_design(self.owner, card, custom_face=b_face)
        self.assertEqual(res.status_code, 400)
        # nor as the company design
        res = self.owner.client.patch(f"{API}workspaces/{self.owner.company}", {"brand": {"design": {"custom_face": b_face}}}, format="json")
        self.assertEqual(res.status_code, 400)
        # and not even if the database row is forced
        Card.objects.filter(pk=card["id"]).update(design={**Card.objects.get(pk=card["id"]).design, "custom_face": b_face})
        got = self.owner.client.get(f"{API}cards/{card['id']}")
        self.assertIsNone(got.data["design"]["custom_face"])
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.owner.company}/custom-faces").data, [])
        self.assertEqual(len(b.client.get(f"{API}workspaces/{b.company}/custom-faces").data), 1)

    def test_personal_workspaces_cannot_use_it(self):
        _, fid = self.go_live()
        person = self.signup("solo@example.com")
        self.buy(person, "personal")
        card = self.make_card(person)
        res = person.client.patch(f"{API}cards/{card['id']}", {"design": {"custom_face": fid}}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(person.client.get(f"{API}workspaces/{person.ws}/custom-faces").data, [])

    def test_disabled_or_deleted_faces_fall_back_without_error(self):
        _, fid = self.go_live()
        card = self.own_card()
        self.set_card_design(self.owner, card, custom_face=fid, face=9)
        published = self.owner.client.post(f"{API}cards/{card['id']}/publish").data
        code = published["public_code"]
        pub = APIClient().get(f"{API}public/cards/{code}").data["card"]
        self.assertEqual(pub["design"]["custom_face"], fid)
        self.assertEqual(pub["custom_face"]["id"], fid)
        self.assertIn("template", pub["custom_face"])
        self.assertEqual(len(pub["custom_face"]["palettes"]), 4)
        self.admin.client.post(f"{API}staff/faces/{fid}/disable", {}, format="json")
        got = self.owner.client.get(f"{API}cards/{card['id']}")
        self.assertEqual(got.status_code, 200)
        self.assertEqual((got.data["design"]["custom_face"], got.data["design"]["face"]), (None, 9))
        pub = APIClient().get(f"{API}public/cards/{code}").data["card"]
        self.assertIsNone(pub["design"]["custom_face"])
        self.assertIsNone(pub["custom_face"])
        # deleting the face row has the same effect
        self.admin.client.post(f"{API}staff/faces/{fid}/enable", {}, format="json")
        self.assertEqual(APIClient().get(f"{API}public/cards/{code}").data["card"]["custom_face"]["id"], fid)
        CustomFace.objects.filter(pk=fid).delete()
        from designs.services import forget_face

        forget_face(fid)
        self.assertIsNone(APIClient().get(f"{API}public/cards/{code}").data["card"]["custom_face"])

    def test_disabling_tells_the_owner_and_counts_cards(self):
        _, fid = self.go_live()
        card = self.own_card()
        self.set_card_design(self.owner, card, custom_face=fid)
        mail.outbox.clear()
        res = self.admin.client.post(f"{API}staff/faces/{fid}/disable", {}, format="json")
        self.assertEqual(res.data["affected_cards"], 1)
        self.assertEqual([m.to[0] for m in mail.outbox], ["owner@acme.test"])
        self.assertIn("switched off", mail.outbox[0].subject)
        self.assertIn("1 cards", mail.outbox[0].body)
        row = AuditEvent.objects.get(action="design_face.disabled")
        self.assertEqual(row.details, {"cards": 1})
        self.assertEqual(self.admin.client.post(f"{API}staff/faces/{fid}/disable", {}, format="json").status_code, 409)

    def test_disable_mail_is_in_arabic_for_an_arabic_owner(self):
        from accounts.models import User

        User.objects.filter(email="owner@acme.test").update(language="ar")
        _, fid = self.go_live()
        mail.outbox.clear()
        self.admin.client.post(f"{API}staff/faces/{fid}/disable", {}, format="json")
        self.assertIn("تم إيقاف", mail.outbox[0].subject)

    def test_company_lock_applies_to_the_custom_face(self):
        _, fid = self.go_live()
        res = self.owner.client.patch(f"{API}workspaces/{self.owner.company}", {"brand": {"design": {"custom_face": fid, "colour": 1}, "lock_design": True}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        emp = self.join(self.invite(self.owner, self.owner.company, "emp@acme.test"))
        card = emp.client.get(f"{API}workspaces/{emp.ws}/cards").data[0]
        self.assertEqual(card["design"]["custom_face"], fid)
        self.assertEqual(card["design"]["colour"], 1)
        # an employee cannot change a locked key
        res = emp.client.patch(f"{API}cards/{card['id']}", {"design": {"custom_face": None, "face": 3}}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["design"]["custom_face"], fid)
        self.assertEqual(res.data["design"]["face"], 1)
        self.assertEqual(emp.client.get(f"{API}workspaces/{emp.company if hasattr(emp, 'company') else emp.ws}/custom-faces").status_code, 200)

    def test_unlocked_employees_may_choose_and_see_the_company_faces(self):
        _, fid = self.go_live()
        emp = self.join(self.invite(self.owner, self.owner.company, "emp@acme.test"))
        faces = emp.client.get(f"{API}workspaces/{emp.ws}/custom-faces").data
        self.assertEqual([f["id"] for f in faces], [fid])
        card = emp.client.get(f"{API}workspaces/{emp.ws}/cards").data[0]
        res = emp.client.patch(f"{API}cards/{card['id']}", {"design": {"custom_face": fid}}, format="json")
        self.assertEqual(res.data["design"]["custom_face"], fid)

    def test_department_standard_face_beats_the_company_custom_face(self):
        _, fid = self.go_live()
        self.owner.client.patch(f"{API}workspaces/{self.owner.company}", {"brand": {"design": {"custom_face": fid}, "lock_design": True, "lock_allows_departments": True}}, format="json")
        dept = self.owner.client.post(f"{API}workspaces/{self.owner.company}/departments", {"name": "Sales", "design": {"face": 12}}, format="json")
        self.assertEqual(dept.status_code, 201, dept.content)
        invite = self.invite(self.owner, self.owner.company, "emp@acme.test", department_id=dept.data["id"])
        emp = self.join(invite)
        card = emp.client.get(f"{API}workspaces/{emp.ws}/cards").data[0]
        self.assertEqual((card["design"]["face"], card["design"]["custom_face"]), (12, None))
        # a department may also pick the company's custom face
        other = self.owner.client.post(f"{API}workspaces/{self.owner.company}/departments", {"name": "Exec", "design": {"custom_face": fid}}, format="json")
        self.assertEqual(other.status_code, 201, other.content)
        bad = self.owner.client.post(f"{API}workspaces/{self.owner.company}/departments", {"name": "Bad", "design": {"custom_face": 424242}}, format="json")
        self.assertEqual(bad.status_code, 400)


class StudioTests(FaceTestCase):
    def test_hostile_template_is_saved_cleaned_with_warnings(self):
        rid, fid = self.start()
        res = self.admin.client.patch(f"{API}staff/faces/{fid}", {
            "template": '<div class="n" onclick="x()">{{name}}<script>alert(1)</script><img src="javascript:alert(1)"></div>',
            "css": ".n{background:url(javascript:alert(1));width:100vw;color:red}",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["template"], '<div class="n">{{name}}</div>')
        self.assertEqual(res.data["css"], ".cfl .face.cf-%d .n{color:red}" % fid)
        codes = {w["code"] for w in res.data["warnings"]}
        self.assertTrue({"event_attr", "dropped_element", "img_src", "value"} <= codes)
        face = CustomFace.objects.get(pk=fid)
        self.assertNotIn("script", face.template)
        self.assertEqual(face.warnings, res.data["warnings"])

    def test_oversize_text_is_refused(self):
        rid, fid = self.start()
        self.assertEqual(self.admin.client.patch(f"{API}staff/faces/{fid}", {"template": "<div></div>" * 6000}, format="json").status_code, 400)
        self.assertEqual(self.admin.client.patch(f"{API}staff/faces/{fid}", {"css": ".a{color:red}\n" * 9000}, format="json").status_code, 400)

    def test_palette_rules(self):
        rid, fid = self.start()
        good = [dict(p) for p in STARTERS["clean"]["palettes"]]
        self.assertEqual(self.admin.client.patch(f"{API}staff/faces/{fid}", {"palettes": good}, format="json").status_code, 200)
        low = [dict(p) for p in good]
        low[2]["fg"] = "#555566"  # unreadable on the dark blue background
        res = self.admin.client.patch(f"{API}staff/faces/{fid}", {"palettes": low}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Colourway 3", res.data["error"]["fields"]["palettes"][0])
        self.assertEqual(self.admin.client.patch(f"{API}staff/faces/{fid}", {"palettes": good[:3]}, format="json").status_code, 400)
        broken = [dict(p) for p in good]
        broken[0]["bg"] = "red"
        self.assertEqual(self.admin.client.patch(f"{API}staff/faces/{fid}", {"palettes": broken}, format="json").status_code, 400)
        self.assertEqual(self.admin.client.patch(f"{API}staff/faces/{fid}", {"palettes": "x"}, format="json").status_code, 400)

    def test_starter_palettes_meet_the_contrast_rules_and_starters_are_clean(self):
        from designs import sanitize

        for key, s in STARTERS.items():
            for p in s["palettes"]:
                self.assertGreaterEqual(contrast_ratio(p["fg"], p["bg"]), 4.5, key)
                self.assertGreaterEqual(contrast_ratio(p["fg"], p["bg2"]), 4.5, key)
                self.assertGreaterEqual(contrast_ratio(p["on"], p["acc"]), 3.0, key)
            t, c, warnings, errors = sanitize.sanitize_face(s["template"], s["css"], 5)
            self.assertEqual(errors, [], key)
            self.assertEqual(warnings, [], key)
            self.assertIn("{{name}}", t)
            self.assertTrue(c.startswith(".cfl .face.cf-5"), key)

    def test_versions_save_and_restore(self):
        rid, fid = self.start()
        self.admin.client.patch(f"{API}staff/faces/{fid}", {"name": "Second idea", "css": ".n{color:red}"}, format="json")
        res = self.admin.client.post(f"{API}staff/faces/{fid}/versions", {"note": "red name"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["version"], 2)
        self.assertEqual([v["number"] for v in res.data["versions"]], [2, 1])
        restored = self.admin.client.post(f"{API}staff/faces/{fid}/versions/1/restore", {}, format="json")
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.data["name"], "Clean, left aligned")
        self.assertNotIn("color:red}", restored.data["css"].split(".bar")[0])
        self.assertEqual(restored.data["version"], 3)
        self.assertEqual(self.admin.client.post(f"{API}staff/faces/{fid}/versions/99/restore", {}, format="json").status_code, 404)

    def test_sanitize_dry_run(self):
        rid, fid = self.start()
        res = self.admin.client.post(API + "staff/faces/sanitize", {"face_id": fid, "template": "<p>{{name}}</p><iframe></iframe>", "css": "@import 'x';.a{color:red}"}, format="json")
        self.assertEqual(res.data["template"], "<p>{{name}}</p>")
        self.assertEqual(res.data["css"], ".cfl .face.cf-%d .a{color:red}" % fid)
        self.assertEqual({w["code"] for w in res.data["warnings"]}, {"dropped_element", "at_rule"})

    def test_media_urls_must_be_the_companys_own(self):
        rid, fid = self.start()
        logo = self.owner.client.post(f"{API}workspaces/{self.owner.company}/logo", {"file": png_upload(name="logo.png")}, format="multipart")
        self.assertEqual(logo.status_code, 200, logo.content)
        url = logo.data["logo_url"] if "logo_url" in logo.data else logo.data["brand"]["logo_url"]
        css = ".n{background-image:url(%s)}" % url
        res = self.admin.client.patch(f"{API}staff/faces/{fid}", {"css": css}, format="json")
        self.assertIn("background-image", res.data["css"])
        other = self.company_with_owner("b@bravo.test", "Bravo")
        theirs = other.client.post(f"{API}workspaces/{other.company}/logo", {"file": png_upload(name="logo.png")}, format="multipart")
        their_url = theirs.data["logo_url"] if "logo_url" in theirs.data else theirs.data["brand"]["logo_url"]
        res = self.admin.client.patch(f"{API}staff/faces/{fid}", {"css": ".n{background-image:url(%s)}" % their_url}, format="json")
        self.assertNotIn("background-image", res.data["css"])

    def test_face_list_and_starters(self):
        rid, fid = self.start()
        self.assertEqual([f["id"] for f in self.admin.client.get(API + "staff/faces").data], [fid])
        self.assertEqual(len(self.admin.client.get(API + "staff/faces", {"workspace": self.owner.company}).data), 1)
        self.assertEqual(self.admin.client.get(API + "staff/faces", {"workspace": "00000000-0000-0000-0000-000000000000"}).data, [])
        self.assertEqual({s["key"] for s in self.admin.client.get(API + "staff/starters").data}, {"clean", "monogram", "split"})
        bad = self.admin.client.post(f"{API}staff/design-requests/{rid}/faces", {"starter": "nope"}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_enable_after_disable(self):
        _, fid = self.go_live()
        self.admin.client.post(f"{API}staff/faces/{fid}/disable", {}, format="json")
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.owner.company}/custom-faces").data, [])
        res = self.admin.client.post(f"{API}staff/faces/{fid}/enable", {}, format="json")
        self.assertEqual(res.data["status"], "live")
        self.assertEqual(len(self.owner.client.get(f"{API}workspaces/{self.owner.company}/custom-faces").data), 1)
        self.assertEqual(self.admin.client.post(f"{API}staff/faces/{fid}/enable", {}, format="json").status_code, 409)
