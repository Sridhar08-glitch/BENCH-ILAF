"""The busiest requests must not run one query per row. These tests compare query counts for a small and a bigger data set."""
from django.db import connection
from django.test.utils import CaptureQueriesContext

from .base import API, ApiTestCase


class QueryCountTests(ApiTestCase):
    def count(self, client, path):
        with CaptureQueriesContext(connection) as ctx:
            res = client.get(API + path)
        self.assertEqual(res.status_code, 200, res.content)
        return len(ctx.captured_queries)

    def test_workspace_list_costs_few_queries_per_workspace(self):
        owner = self.signup()
        one = self.count(owner.client, "me/workspaces")
        for n in range(3):
            self.company(owner, f"Company {n}", seats=2)
        four = self.count(owner.client, "me/workspaces")
        # Each extra workspace adds only the subscription and the card count, not the brand, domain and security documents.
        self.assertLessEqual((four - one) / 3, 4, f"{one} queries for 1 workspace, {four} for 4")

    def test_card_list_does_not_grow_with_the_number_of_cards(self):
        owner = self.signup()
        ws = self.company(owner, "Many Cards Ltd", seats=8)
        for i in range(3):
            self.invite(owner, ws, f"p{i}@example.com", full_name=f"Person {i}")
        few = self.count(owner.client, f"workspaces/{ws}/cards")
        for i in range(3, 7):
            self.invite(owner, ws, f"p{i}@example.com", full_name=f"Person {i}")
        many = self.count(owner.client, f"workspaces/{ws}/cards")
        self.assertEqual(few, many, "the card list runs extra queries for every card")
