# Frontend Changes — 2026-04-21

---

## 1. `GET /clientData` — now includes upcoming events

The response now contains a top-level `upcoming_events` array.

```jsonc
{
  "client": { ... },
  "programs": [ ... ],
  "terminals": [ ... ],
  "historical_terminals": [ ... ],
  "upcoming_events": [
    {
      "id": 1,
      "title": "Driver Meeting",
      "description": "Monthly check-in at the office.",
      "event_date": "2026-05-01T14:00:00Z",
      "location": "123 Main St, Brooklyn"
    }
  ],
  "summary": { ... },
  "heatmap": { ... }
}
```

- Always present — empty array `[]` when there are no upcoming events.
- Sorted ascending by `event_date` (soonest first).
- Only future events — no query param needed.
- `description` and `location` can be `null`.

---

## 2. Company client login

Company clients log in with **username**, not email. The backend converts it internally.

**POST /auth/client/login**
```json
{ "username": "acme_corp", "password": "..." }
```

The login form should detect whether the input contains `@` and send `email` or `username` accordingly:

```js
const isEmail = value.includes("@");
const body = isEmail
  ? { email: value, password }
  : { username: value, password };
```
