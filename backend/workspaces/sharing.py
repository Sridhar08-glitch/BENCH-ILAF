"""The employee's switch "share my new contacts with the company".

One definition for everything that depends on it. The rule:

* In a company, the contacts, orders and bookings that arrive on an employee's card belong to that employee. Owners and admins do not see them.
* An employee (role `employee`) may switch `Member.share_contacts` on. From that moment, what arrives on their cards ALSO belongs to the
  company. The decision is a snapshot: `shared_with_company` is written on the contact, order or booking when it is created, from the switch at
  that moment, and never changes afterwards. Switching off stops sharing for what arrives later; what was already shared stays with the company.
* The company's own card, and a card nobody holds, are always the company's. Personal workspaces and the cards of owners and admins have nothing
  to share: the snapshot is always False there.

Everywhere a contact is judged "company owned" (leads.models.is_company_owned / company_owned_leads, leads.workflow.visible_leads / can_see,
workspaces.access.commerce_orders / commerce_bookings, card_recipients, webhooks, CRM, the developer API, exports, analytics) it reads the
snapshot; none of them looks at the live switch.
"""


def card_shares_with_company(card):
    """The value of `shared_with_company` for something that arrives on this card right now."""
    if card is None or not card.member_id or card.is_company:
        return False
    ws = card.workspace
    if ws.kind != "company":
        return False
    member = card.member
    return bool(member.role == "employee" and member.status == "active" and member.share_contacts)
