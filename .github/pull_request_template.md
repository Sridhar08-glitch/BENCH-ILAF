## What changes and why

<!-- One or two plain sentences. -->

## How it was checked

- [ ] Backend tests pass (`python manage.py test --parallel`)
- [ ] Web checks pass (`npx tsc --noEmit`, `npm run lint`, `npm test`)
- [ ] Browser smoke tests pass (`npm run e2e:smoke`) when a screen changed
- [ ] New or changed screens work in Arabic (right to left) as well

## Risk

- [ ] No payment, sign-in or privacy rules changed (or the owner approved the change)
- [ ] A migration, if any, can be undone and was run on a copy of real data
- [ ] No secrets, passwords or real customer data in the change
- [ ] The README or `deploy/` notes are updated when set-up steps changed

## Screenshots (screens only)
