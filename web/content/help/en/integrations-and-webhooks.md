---
title: Integrations and webhooks
summary: Send every new contact to the tools your team already uses.
audience: company_owner, company_admin
pages: /app/settings/integrations
related: exchange-contacts-and-leads
updated: 2026-11-22
---

Open Settings, then Integrations. Owners and admins of a company workspace can set this up, and the company needs a live plan.

## Add a webhook
A webhook is an address that gets a small message each time something happens to a contact. Press Add webhook, paste the address (it must start with https:// and be public), and choose the events: New lead, Lead changed, Lead assigned.

## Connect Zapier or Make
1. In Zapier start a Zap and choose Webhooks by Zapier, then Catch Hook. In Make add a Custom webhook.
2. Copy the address they give you.
3. Here, press Add webhook, paste it and choose the events.
4. Press Send test event. Zapier or Make now shows a sample contact to build the next step with.

## Keep an eye on it
Each webhook can be switched on or off, tested and given a new secret. The delivery log shows the result of each send. If your receiver is down we try again up to 8 times over about a day, and a webhook that fails 20 times in a row is switched off.

> The signing secret is shown once. Copy it when you create it. Zapier and Make do not need it, but your own systems should check it.
