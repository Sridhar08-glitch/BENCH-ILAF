# Device test checklist

For the owner. Do this on real devices before the first customer, and again after big changes. Write the date, the device and what you saw.
Use the real address of the site (for example `https://app.YOURDOMAIN`), a test e-mail account you can open on the phone, and a second
person or second phone for the "scan" steps. Tick a box only if the **expected result** happened. If not, write what happened and take a screenshot.

Tester: ____________  Date: ____________  Version / commit: ____________

Devices: **A** iPhone with Safari (iOS version ______)  **B** Android phone with Chrome (Android version ______)  **C** Windows laptop with Chrome and Edge

Mark each line per device: A / B / C.

## 1. Sign up and sign in

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 1.1 | Open the site. Tap Create account. Enter name, e-mail, a password of 8 or more characters. | You land in the dashboard. No error. A welcome box appears. | [ ] | [ ] | [ ] |
| 1.2 | Sign out (menu). Sign in again with the same details. | You are back in the dashboard. | [ ] | [ ] | [ ] |
| 1.3 | Sign in with a wrong password. | A clear error. You stay on the sign-in page. | [ ] | [ ] | [ ] |
| 1.4 | Tap "Forgot your password?", enter the e-mail. Open the mail on the phone. Tap the link. Choose a new password. | The link opens the browser on the reset page (not a blank page). The new password works. | [ ] | [ ] | [ ] |
| 1.5 | If Google sign-in is switched on: tap "Continue with Google" and choose an account. | You are signed in. (Skip this line when the button is not shown.) | [ ] | [ ] | [ ] |

## 2. Create and publish a card

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 2.1 | Cards, New card. Fill name, job title, company. | "All changes saved" appears after a moment. The preview shows your text. | [ ] | [ ] | [ ] |
| 2.2 | Buttons tab: add a phone, an e-mail, a website. | They show on the preview. | [ ] | [ ] | [ ] |
| 2.3 | Upload a photo from the phone gallery (A, B) or a file (C). | The photo shows in the preview, cropped well. | [ ] | [ ] | [ ] |
| 2.4 | Design tab: go through every step (face, colours, text, below the card, animation, finish). | Every step works, the preview follows. "Your design is saved". | [ ] | [ ] | [ ] |
| 2.5 | Tap Publish. | The status says Published. | [ ] | [ ] | [ ] |
| 2.6 | Tap "New tab" / open the public page. | The card opens, looks like the preview, the animation plays once. | [ ] | [ ] | [ ] |
| 2.7 | Tap the card. | It flips to the QR side. Tap again: it flips back. | [ ] | [ ] | [ ] |

## 3. Share the card

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 3.1 | QR and share page: tap Share. Choose WhatsApp. Send it to a second phone. | WhatsApp opens with the card link. On the second phone the link shows a picture preview with the name. | [ ] | [ ] | n/a |
| 3.2 | On the second phone tap the link in WhatsApp. | The card opens in the browser. | [ ] | [ ] | [ ] |
| 3.3 | Open the QR code on one device. Scan it with the camera of another phone (iPhone: Camera app; Android: Camera or Google Lens). | A link appears. Tapping it opens the card. | [ ] | [ ] | [ ] |
| 3.4 | Copy link: paste it in a note. | The link works and is the short card address. | [ ] | [ ] | [ ] |
| 3.5 | On the dashboard, look at the visits count after steps 3.2 and 3.3. | Visits went up (may take a minute). | [ ] | [ ] | [ ] |

## 4. Save the contact (vCard)

Do this on the public card page of the card you made, as if you were a visitor.

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 4.1 | Tap "Save contact". | A "New Contact" sheet shows name, job, phone, e-mail. | [ ] | [ ] | [ ] |
| 4.2 | iPhone: open the contact file (the download offers "Contacts" or opens a preview): tap Add / Create New Contact. Android: tap the downloaded `.vcf` and choose Contacts. | The contact is in the phone's contacts with all fields and the right name spelling (Arabic names too). | [ ] | [ ] | n/a |
| 4.3 | Laptop: the `.vcf` file downloads. Double-click it. | It opens in the Windows People / Outlook / Mail app, or the browser asks where to open it. | n/a | n/a | [ ] |
| 4.4 | Check the contact: photo (if you set one), website, note "Saved from my BENCH card". | They are there. | [ ] | [ ] | [ ] |

## 5. "Share your details" (the exchange form)

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 5.1 | On the public card (second phone, not signed in): tap "Share your details". Fill name and e-mail. Tick the agreement. Send. | "Thank you". | [ ] | [ ] | [ ] |
| 5.2 | On your phone, Contacts in the dashboard. | The visitor appears with the right name, within a minute. You got an e-mail about it. | [ ] | [ ] | [ ] |
| 5.3 | Try to send the form without ticking the agreement. | It is refused with a message. | [ ] | [ ] | [ ] |

## 6. NFC (Android Chrome only)

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 6.1 | Dashboard, NFC card writer, with an empty NFC tag or card. Tap "Write". Hold the tag to the back of the phone. | "Written". | n/a | [ ] | n/a |
| 6.2 | Hold the tag to another phone (screen on, unlocked). | The card opens by itself in the browser. | [ ] | [ ] | n/a |
| 6.3 | On iPhone open the page. | The page says writing needs Android Chrome (no crash). Reading a tag still works (6.2). | [ ] | n/a | n/a |

## 7. Install the app and use it offline

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 7.1 | iPhone: Share button, Add to Home Screen. Android: menu, Install app / Add to Home screen. Laptop (Chrome/Edge): the install icon in the address bar. | An icon with the BENCH logo appears on the home screen / desktop. It opens without browser bars. | [ ] | [ ] | [ ] |
| 7.2 | Open the installed app. Go to QR and share. | Your QR code shows. | [ ] | [ ] | [ ] |
| 7.3 | Turn on flight mode. Open the installed app again, QR page. | The QR code still shows (offline). Other pages say you are offline instead of a blank page. Turn flight mode off: it works again. | [ ] | [ ] | [ ] |

## 8. Arabic and right-to-left

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 8.1 | Switch the language to العربية (bottom of the menu or the sign-in page). | Everything turns right to left. Menus on the right. No text cut off or overlapping. | [ ] | [ ] | [ ] |
| 8.2 | Make a card with an Arabic name and job title. Publish. Open the public page. | The Arabic text is joined correctly, reads right to left, numbers look right. | [ ] | [ ] | [ ] |
| 8.3 | Save the contact (section 4) with the Arabic name. | The name is correct in the phone's contacts. | [ ] | [ ] | [ ] |
| 8.4 | Switch back to English. | Left to right again. | [ ] | [ ] | [ ] |

## 9. Scan a paper business card with the camera

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 9.1 | Dashboard, Scan a paper card. Allow the camera. Photograph a printed card (use an English one and an Arabic one). | The name, phone, e-mail and company are filled in (not perfect: check them). Nothing is sent to anyone else's server (it reads in the browser). | [ ] | [ ] | [ ] |
| 9.2 | Correct a field and save it as a contact. | It appears in Contacts. | [ ] | [ ] | [ ] |
| 9.3 | Refuse the camera permission instead. | A clear message with a way to choose a photo from the gallery. | [ ] | [ ] | [ ] |

## 10. Company, invitations and e-mail links on phones

| # | Steps | Expected result | A | B | C |
|---|---|---|---|---|---|
| 10.1 | On the laptop create a company (workspace menu, New company) and open Team. Invite your phone's e-mail address. | "1 invitation sent". | n/a | n/a | [ ] |
| 10.2 | On the phone open the invitation e-mail in the Mail app (iPhone: Mail; Android: Gmail). Tap the button. | The browser opens the "Join your team" page with the company name (not the app store, not a blank page). | [ ] | [ ] | n/a |
| 10.3 | Choose a password, join. | You land in the dashboard with a draft card in the company design. | [ ] | [ ] | n/a |
| 10.4 | Open the e-mail inside Gmail / Outlook apps' own browser and tap the link. | It still opens and joining works (some mail apps open links in a small built-in browser). | [ ] | [ ] | n/a |
| 10.5 | Dark mode: set the phone to dark mode and open the invitation e-mail and the dashboard. | The e-mail text is readable (no dark text on dark background). | [ ] | [ ] | [ ] |

## 11. Quick checks on every device

| # | Check | A | B | C |
|---|---|---|---|---|
| 11.1 | Rotate the phone on the public card: the card stays centred and readable | [ ] | [ ] | n/a |
| 11.2 | Zoom the laptop browser to 200%: pages still usable, no sideways scrolling in the dashboard | n/a | n/a | [ ] |
| 11.3 | Slow connection (phone on 3G/weak signal): the public card shows its text first, then the picture | [ ] | [ ] | n/a |
| 11.4 | Back button after saving a card or after Publish: goes to the previous page, no error | [ ] | [ ] | [ ] |
| 11.5 | Keyboard only on the laptop (Tab, Enter, Esc): you can sign in, open the editor, close a dialog with Esc | n/a | n/a | [ ] |
| 11.6 | Print the public card page or the QR page from the laptop: the QR code is not cut | n/a | n/a | [ ] |

## Result

Problems found (number, device, what happened, screenshot file):

1. ________________________________________________
2. ________________________________________________
3. ________________________________________________

Ready for customers?  [ ] Yes   [ ] No, after fixing: ____________  Signed: ____________
