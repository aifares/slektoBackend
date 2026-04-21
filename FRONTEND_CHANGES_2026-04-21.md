# Frontend Changes — 2026-04-21

---

## 1. `GET /clientData` — now includes upcoming events

The response now contains a top-level `upcoming_events` array showing the client's future planned campaigns.

```jsonc
{
  "client": { ... },
  "programs": [ ... ],
  "terminals": [ ... ],
  "historical_terminals": [ ... ],
  "upcoming_events": [
    {
      "program_id": 2917691,
      "program_name": "Gorgie - 2026-06-01 Split",
      "start_at": "2026-06-01T00:08:00Z",
      "end_at": "2026-07-01T00:00:00Z",
      "hours_bought": 500,
      "mode": "split"
    }
  ],
  "summary": { ... },
  "heatmap": { ... }
}
```

- Always present — empty array `[]` when there are no upcoming planned campaigns.
- Sorted ascending by `start_at` (soonest first).
- Only campaigns with `status = "planned"` and `start_at` in the future.
- `program_name` can be `null` if the program record is missing.

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
