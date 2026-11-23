# Accessibility findings

Status: **the automated scan is written but has not been run yet.** The machine that built it had too little memory to run Chrome
next to the other work, so there are no measured violations to list. This file is where they go.

## How to get the real list (about 5 minutes)

1. Start the API and the website as described in `web/e2e/README.md`.
2. `cd web && A11Y_UPDATE_BASELINE=1 npm run e2e:a11y`
   This scans 10 pages in English (left to right) and Arabic (right to left) with axe-core (WCAG 2.0/2.1 A and AA rules), writes
   `web/e2e/artifacts/a11y-report.json` (every finding: rule, impact, how many elements, the first three selectors) and records the serious and
   critical ones in `web/e2e/a11y/baseline.json`.
3. Copy the findings from the report into the table below. Commit `baseline.json`.
4. From then on `npm run e2e:a11y` (and the CI) fails when a NEW serious or critical rule appears, or when a known rule affects more elements than recorded.
   Fix a problem, then run step 2 again to lower the baseline.

Pages scanned: sign-in, register, privacy, public card, dashboard home, card editor, contacts, help centre, brand, team (company workspace).

## Table of findings (fill in after the first run)

| Page | Dir | Rule | Impact | Elements | File to look at | Suggested fix |
|---|---|---|---|---|---|---|
| | | | | | | |

## Where to look first (from reading the code, not measured)

These are the usual sources of axe findings in this kind of screen. Treat them as a checklist, not as confirmed problems:

| Area | File | What axe usually reports |
|---|---|---|
| Colour contrast of grey hint text and pills on white or dark panels | `web/src/app/globals.css` (`.hint`, `.pill`, `.sub`) | `color-contrast` (serious) in light and dark mode |
| Card drawing on the public page (card faces are generated markup) | `web/src/components/card/CardMarkup.tsx`, `web/src/lib/library` | `color-contrast` on small text over photos and gradients; `role="button"` card containing links |
| Icon-only buttons | `web/src/components/ButtonIcon.tsx`, `web/src/components/app/Shell.tsx` | `button-name` when an icon button has no `aria-label` |
| Tabs and tab panels | `web/src/components/editor/CardEditor.tsx` (`role="tablist"`) | `aria-required-children`, panels without a label |
| Selects and inputs inside rows (team, contacts) | `web/src/app/app/team/page.tsx`, `web/src/app/app/contacts/page.tsx` | `label`, `select-name` where a visible label is missing |
| Colour inputs on the brand page | `web/src/components/brand/BrandPanels.tsx` | `label` on `input[type=color]` (labels exist: check Arabic text) |
| The honeypot field of the contact form (hidden on purpose) | `web/src/app/c/[code]/ExchangeDialogs.tsx` (`Honeypot`) | `aria-hidden-focus` (it uses `tabIndex=-1`, which is fine) |
| Arabic pages | all | `html-has-lang` / `valid-lang` after a language switch; mirrored layouts overlapping |

## What the scan cannot find (do these by hand, see `DEVICE_TEST_CHECKLIST.md`)

Keyboard-only use (Tab order, focus visible, no focus trap except in dialogs), screen reader reading order (VoiceOver on iPhone, TalkBack on Android),
zoom to 200%, reduced motion (the card opening animation), and whether the colours are readable for someone with colour blindness.
