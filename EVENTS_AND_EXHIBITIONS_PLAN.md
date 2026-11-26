# Events, exhibitions and fairs: how Bench can serve them (ideas and plan)

Written 2026-11-26. Ideas and a build order, not yet built. The "legal" notes need checking with a lawyer before launch.

## Who is in the room, and what each needs
| Who | Their problem | What Bench can give |
|---|---|---|
| **Exhibitor** (booth staff) | Hundreds of visitors, paper forms and lost business cards, no follow-up | Fast lead capture, qualified leads, automatic follow-up, a report for the boss |
| **Organiser** | Badges, speaker pages, sponsor value, proof of results | Branded cards for everyone, attendee directory, sponsor lead reports |
| **Speaker / VIP** | Wants people to find them after the talk | A card with talk topic, slides link, booking |
| **Visitor** | Collects brochures and cards and forgets who was who | One tap to save, "met at {event}" tag, a reminder to follow up |

## What Bench already has that fits (no new invention needed)
QR code and NFC card, Event mode (full-screen QR, quick "I met someone" notes, end-of-event summary), Scan paper card, contact tags by source, the card "event" block (date and place), booking, products and orders, Google Wallet pass, company brand and locked design, team cards in bulk (CSV import), company directory, webhooks and CRM.

## Ideas, from most useful to most ambitious

### A. Booth kit (exhibitors): build first
1. **Booth QR poster:** print-ready A4/A3 and roll-up banner with the company brand and a big QR: "Scan to get our catalogue / meet the team". Generated in one click.
2. **Kiosk mode:** a tablet on the stand shows the company card and a short form (name, phone/email, interest). Visitors tap, leave details, and the tablet resets for the next person. No app, no login.
3. **Lead qualification:** after capture, staff tap Hot / Warm / Cold, interest tags, a note, and a photo of the visitor's badge or business card (Scan already reads these).
4. **Instant follow-up:** the visitor gets an email or WhatsApp-style message with the brochure/catalogue link right away, and the staff member gets a reminder after the event.
5. **Event report:** leads per day, per hour and per staff member, hot-lead list, export to CSV or CRM. This is what the manager pays for.
6. **Fits the privacy rules:** booth leads go to the company card, so owners and admins see them. A staff member's private contacts stay private unless they turn on sharing.

### B. Organiser pack
1. **Bulk badge cards:** import the attendee, speaker and sponsor lists from CSV. Each person gets a card, and the printed badge QR opens it.
2. **Attendee directory (opt-in):** people choose to be listed, so attendees can find and message each other. Opt-in only.
3. **Speaker and sponsor pages:** talk title, time, slides link, "book a meeting" slot.
4. **Sponsor lead retrieval:** sponsors scan badges and get the leads they collected. This can be sold to sponsors as an extra.
5. **Post-event report:** attendance, scans, most visited booths, connections made.

### C. Visitor and speaker experience
1. **"Met at {event}" tag** on every contact saved through event mode.
2. **Reminder after 24 hours:** "You met 12 people yesterday. Send a hello?"
3. **Event pass in Wallet:** the badge as a wallet pass, with the QR.
4. **Raffle or survey by QR:** collect consented contacts for a prize draw or a feedback form.

### D. Physical services around the card (extra revenue)
Printed NFC cards and badges, lanyards, QR stands, booth posters and banners, ordered through a partner printer. Bench earns a margin and the customer gets one supplier.

## Rules and risks
- **Consent and privacy:** collecting visitors' details needs a clear consent line (the lead form already has one). Qatar has a personal data protection law, so keep retention rules and a delete option. A lawyer should confirm the wording.
- **Offline:** fair halls often have bad Wi-Fi. Event mode already saves notes offline. Kiosk mode needs the same: store entries on the tablet and send them when the connection returns.
- **Duplicates:** the same visitor may be scanned by two staff members. Merge by phone or email.
- **Don't promise what we can't run:** printing, shipping and badge hardware need a partner and delivery times.

## Plan
| Phase | Build | Why first |
|---|---|---|
| **1 (about 3 weeks)** | Booth QR poster, kiosk mode with offline queue, hot/warm/cold and tags on leads, instant follow-up message, event report with CSV | Reuses Event mode, Scan and leads; a clear product to sell to exhibitors |
| **2 (about 4 weeks)** | Event workspace type: bulk badge cards from CSV, speaker and sponsor pages, opt-in attendee directory | For organisers; builds on the team and directory features |
| **3 (about 4 weeks)** | Sponsor lead retrieval, raffle and survey by QR, registration-system hookup (API), partner printing orders | Extra revenue lines |

## How to sell it
- **Event Pack:** a one-off price per event (for example per booth or per number of badges), not a yearly subscription, because events are short.
- **Exhibitor plan:** company seats for the staff on the stand for the length of the fair.
- **Organiser deal:** price by number of attendees, with sponsor lead retrieval as an add-on.
- **Print services:** a margin on partner-printed items.
Set the actual prices with real customer feedback. I have not invented any numbers.
