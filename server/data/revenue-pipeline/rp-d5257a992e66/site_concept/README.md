# Staged site concept — Pilch Dachbau

Concept built from a user-provided URL audit. Replace every placeholder with verified customer data before any use.

## Build & verify (real commands, no publishing)

```
npm install
npm run build     # tsc -b && vite build → dist/
node tests/verify.mjs
```

## Staging notes

- Replace every `[PLACEHOLDER: …]` with verified customer data before ANY use.
- Add real photos, real reviews (with consent), Impressum/Datenschutz (legal review).
- Do NOT publish, deploy, or share this concept externally without customer approval.
