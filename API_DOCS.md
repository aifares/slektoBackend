# Slekto API Documentation

**Base URL (dev):** `http://localhost:3001`
**Base URL (prod):** `https://slekto-backend.fly.dev`

**Authentication:** All protected routes require a Bearer token in the Authorization header.
```
Authorization: Bearer <access_token>
```

There are two separate auth flows — one for **admin/client users** (Supabase email login) and one for **drivers** (SMS OTP login). The tokens look the same but resolve to different user types.

---

## Table of Contents

- [Client Auth](#client-auth) — Login for agency + company clients
- [Driver Auth](#driver-auth) — OTP login for drivers
- [Driver Portal](#driver-portal) — Driver-facing endpoints
- [Admin — Clients](#admin--clients) — Create client accounts, link to campaigns (admin only)
- [Admin — Drivers](#admin--drivers) — Notifications, events, pay (admin only)
- [Admin — Campaigns](#admin--campaigns) — Campaign management (admin only)
- [Admin — Media & System](#admin--media--system) — Sync, snapshots (admin only)
- [Clients](#clients) — Client campaign management
- [Drivers (Admin)](#drivers-admin) — Driver records management
- [Terminals](#terminals) — Terminal management

---

## Client Auth

> No authentication required. Used by both agency and company clients to log in to the client dashboard.

### Login
```
POST /auth/client/login
```

**Company client (username + password):**
```json
{
  "username": "acme_corp",
  "password": "SecurePass123!"
}
```

**Agency client (email + password):**
```json
{
  "email": "contact@bigagency.com",
  "password": "SecurePass123!"
}
```

**Response 200**
```json
{
  "success": true,
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600,
  "client": {
    "id": 5,
    "name": "Acme Corp",
    "client_type": "company",
    "username": "acme_corp",
    "role": "user"
  }
}
```

**Error responses**
| Status | Meaning |
|--------|---------|
| 400 | Missing username/email or password |
| 401 | Invalid credentials |
| 403 | Account suspended or deleted |

---

### Refresh Session
```
POST /auth/client/refresh
```
**Body:** `{ "refresh_token": "eyJ..." }`

---

## Admin — Clients

> Requires admin Bearer token. User must have `role: "admin"`.

### Create Client + Link to Campaign
```
POST /admin/clients/create
```
Creates a login account for a client and immediately links it to an existing campaign. A `campaign_id` is always required.

**Company account** (admin sets credentials):
```json
{
  "client_type": "company",
  "name": "Acme Corp",
  "username": "acme_corp",
  "password": "SecurePass123!",
  "campaign_id": 12
}
```

**Agency account** (client sets their own password via email):
```json
{
  "client_type": "agency",
  "name": "Big Agency LLC",
  "email": "contact@bigagency.com",
  "campaign_id": 12
}
```

| Field | Required for | Rules |
|-------|-------------|-------|
| `client_type` | both | `"agency"` or `"company"` |
| `name` | both | Display name |
| `campaign_id` | both | Must exist and not already have a client |
| `username` | company | Letters, numbers, underscores only. Used to log in. |
| `password` | company | Min 8 characters |
| `email` | agency | Real email — receives password setup link |

**Response 201**
```json
{
  "success": true,
  "client": {
    "id": 7,
    "name": "Acme Corp",
    "client_type": "company",
    "username": "acme_corp",
    "account_status": "active"
  },
  "campaign": {
    "id": 12,
    "status": "planned",
    "hours_bought": 10,
    "start_at": "2026-05-01T00:00:00Z",
    "end_at": "2026-06-01T00:00:00Z"
  },
  "login": {
    "username": "acme_corp",
    "note": "Share these credentials with the client"
  }
}
```
For agency accounts, `login.note` will say `"Password reset email sent to contact@bigagency.com"`.

**Error responses**
| Status | Meaning |
|--------|---------|
| 400 | Missing fields or invalid username/password format |
| 404 | Campaign not found |
| 409 | Campaign already has a client, or username/email taken |

---

### List All Clients
```
GET /admin/clients?client_type=company
```
Optional `client_type` filter: `agency` or `company`.

**Response 200**
```json
{
  "success": true,
  "count": 10,
  "clients": [
    {
      "id": 7,
      "name": "Acme Corp",
      "client_type": "company",
      "username": "acme_corp",
      "email": null,
      "account_status": "active",
      "role": "user",
      "campaigns": [{ "id": 12, "status": "planned" }],
      "campaign_count": 1,
      "created_at": "2026-04-18T00:00:00Z"
    }
  ]
}
```

---

### Update Client
```
PATCH /admin/clients/:id
```
Update name, status, or reset password (company only).

**Body** (all optional):
```json
{
  "name": "Acme Corp Updated",
  "account_status": "suspended",
  "password": "NewPassword123!"
}
```
`account_status` values: `active` `suspended` `deleted`
`password` is only allowed for `company` type clients.

---

## Driver Auth

> No authentication required for these routes.

### Send OTP
```
POST /auth/driver/send-otp
```
Sends a 6-digit SMS code to the driver's phone. The phone must already exist in the driver database and be in `approved` status (pending drivers get a flag in the response, rejected/inactive are blocked).

**Body**
```json
{
  "phone": "9174702290"
}
```

**Response 200**
```json
{
  "success": true,
  "message": "OTP sent",
  "pending": false
}
```

**Error responses**
| Status | Meaning |
|--------|---------|
| 400 | `phone` field missing |
| 403 | Driver is rejected or inactive |
| 404 | No driver account for this phone number |
| 500 | Twilio/Supabase error |

---

### Verify OTP
```
POST /auth/driver/verify-otp
```
Verifies the 6-digit code. On first login, automatically links the Supabase auth account to the existing driver record (no pre-migration needed).

**Body**
```json
{
  "phone": "9174702290",
  "token": "123456"
}
```

**Response 200**
```json
{
  "success": true,
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600,
  "driver": {
    "id": 42,
    "name": "John Smith"
  }
}
```

**Error responses**
| Status | Meaning |
|--------|---------|
| 400 | `phone` or `token` missing |
| 401 | Invalid or expired OTP |
| 403 | Driver is pending, rejected, or inactive |
| 404 | No driver account for this phone |

---

### Refresh Session
```
POST /auth/driver/refresh
```
Exchange a refresh token for a new access token.

**Body**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response 200**
```json
{
  "success": true,
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

---

## Driver Portal

> All routes require a driver Bearer token (`Authorization: Bearer <driver_access_token>`).

### Get Profile
```
GET /driver-portal/me
```
Returns the driver's profile and their current terminal assignment (if active).

**Response 200**
```json
{
  "success": true,
  "driver": {
    "id": 42,
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "9174702290",
    "status": "approved",
    "city": "New York",
    "state": "NY",
    "member_since": "2025-01-15T00:00:00Z"
  },
  "current_assignment": {
    "terminal_id": "SN-001",
    "terminal_name": "Terminal A",
    "group_name": "Brooklyn",
    "assigned_since": "2026-04-18T09:00:00Z"
  }
}
```
`current_assignment` is `null` if the driver has no active assignment.

---

### Get Notifications
```
GET /driver-portal/notifications
```
Returns in-app notifications sent to this driver or broadcast to all drivers.

**Query params**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `unread_only` | boolean | `false` | Pass `true` to return only unread |
| `limit` | number | `20` | Max results |
| `offset` | number | `0` | Pagination offset |

**Response 200**
```json
{
  "success": true,
  "count": 3,
  "notifications": [
    {
      "id": 1,
      "driver_id": null,
      "title": "Schedule update",
      "body": "Tomorrow's shift starts at 8am instead of 9am.",
      "sent_via": "both",
      "sent_at": "2026-04-18T10:00:00Z",
      "read_at": null,
      "created_at": "2026-04-18T10:00:00Z"
    }
  ]
}
```
`driver_id: null` means it was a broadcast to all drivers.

---

### Mark Notification as Read
```
PATCH /driver-portal/notifications/:id/read
```

**Response 200**
```json
{
  "success": true,
  "message": "Marked as read"
}
```

---

### Get Events
```
GET /driver-portal/events
```
Returns upcoming events visible to this driver (events targeted to them + all-driver events).

**Query params**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `include_past` | boolean | `false` | Pass `true` to include past events |

**Response 200**
```json
{
  "success": true,
  "count": 2,
  "events": [
    {
      "id": 1,
      "title": "Driver Meeting",
      "description": "Monthly check-in at the office.",
      "event_date": "2026-05-01T14:00:00Z",
      "location": "123 Main St, Brooklyn",
      "driver_id": null,
      "created_at": "2026-04-18T00:00:00Z"
    }
  ]
}
```
`driver_id: null` means the event is visible to all drivers.

---

### Get Pay
```
GET /driver-portal/pay
```
Returns all-time totals plus a full breakdown by monthly pay period → day → individual shifts.

**Response 200**
```json
{
  "success": true,
  "driver_id": 42,
  "hourly_rate": 3.00,
  "total_hours": 142.5,
  "total_pay": 427.50,
  "active_shift": {
    "id": 99,
    "terminal_id": "SN-001",
    "terminal_name": "Terminal A",
    "start": "2026-04-18T09:00:00Z",
    "hours_so_far": 3.25
  },
  "pay_periods": [
    {
      "period": "2026-04",
      "label": "April 2026",
      "total_hours": 82.5,
      "total_pay": 247.50,
      "days": [
        {
          "date": "2026-04-18",
          "day_hours": 10.0,
          "day_pay": 30.00,
          "shifts": [
            {
              "id": 88,
              "terminal_id": "SN-001",
              "terminal_name": "Terminal A",
              "start": "2026-04-18T08:00:00Z",
              "end": "2026-04-18T18:00:00Z",
              "hours": 10.0,
              "pay": 30.00,
              "notes": null
            }
          ]
        }
      ]
    }
  ]
}
```
- `active_shift` is `null` if no shift is currently open
- `pay_periods` sorted newest first; `days` within each period also sorted newest first
- Only completed shifts (with `end` timestamp) count toward totals

---

## Admin — Drivers

> Requires admin Bearer token. User must have `role: "admin"`.

### Send Notification
```
POST /admin/drivers/notify
```
Send an in-app notification, SMS, or both to one driver, a list of drivers, or all approved drivers.

**Body**
```json
{
  "title": "Shift reminder",
  "body": "Your shift starts tomorrow at 8am.",
  "sent_via": "both",
  "driver_ids": [1, 2, 3]
}
```

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `title` | Yes | string | Notification title |
| `body` | Yes | string | Notification message |
| `sent_via` | No | `"in_app"` `"sms"` `"both"` | Default: `"in_app"` |
| `driver_ids` | No | array of integers | Omit to send to **all** approved drivers |

**Response 200**
```json
{
  "success": true,
  "message": "Notification sent",
  "sms": {
    "sent": 12,
    "failed": 0,
    "total": 12,
    "errors": []
  }
}
```
`sms` is `null` when `sent_via` is `"in_app"`.

---

### List All Events
```
GET /admin/drivers/events
```

**Response 200**
```json
{
  "success": true,
  "count": 5,
  "events": [
    {
      "id": 1,
      "title": "Driver Meeting",
      "description": "Monthly check-in.",
      "event_date": "2026-05-01T14:00:00Z",
      "location": "123 Main St",
      "driver_id": null,
      "drivers": null,
      "created_by": "uuid-of-admin",
      "created_at": "2026-04-18T00:00:00Z"
    }
  ]
}
```

---

### Create Event
```
POST /admin/drivers/events
```

**Body**
```json
{
  "title": "Driver Meeting",
  "description": "Monthly check-in at the office.",
  "event_date": "2026-05-01T14:00:00Z",
  "location": "123 Main St, Brooklyn",
  "driver_id": null
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Event title |
| `event_date` | Yes | ISO 8601 datetime |
| `description` | No | Optional details |
| `location` | No | Address or place name |
| `driver_id` | No | Target one driver. Omit (or `null`) for all-driver event |

**Response 201**
```json
{
  "success": true,
  "event": { "id": 1, "title": "Driver Meeting", ... }
}
```

---

### Update Event
```
PATCH /admin/drivers/events/:id
```
Send only the fields you want to change.

**Body** (all fields optional)
```json
{
  "title": "Updated title",
  "event_date": "2026-05-02T14:00:00Z",
  "location": "456 Other St",
  "description": "New details",
  "driver_id": null
}
```

**Response 200**
```json
{
  "success": true,
  "event": { ... }
}
```

---

### Delete Event
```
DELETE /admin/drivers/events/:id
```

**Response 200**
```json
{
  "success": true,
  "message": "Event deleted",
  "event": { ... }
}
```

---

### Pay Summary (All Drivers)
```
GET /admin/drivers/pay
```
Returns all-time totals and monthly pay period breakdown for every driver.

**Response 200**
```json
{
  "success": true,
  "count": 15,
  "drivers": [
    {
      "driver_id": 42,
      "name": "John Smith",
      "phone": "9174702290",
      "status": "approved",
      "hourly_rate": 3.00,
      "total_hours": 142.5,
      "total_pay": 427.50,
      "pay_periods": [
        {
          "period": "2026-04",
          "label": "April 2026",
          "total_hours": 82.5,
          "total_pay": 247.50
        },
        {
          "period": "2026-03",
          "label": "March 2026",
          "total_hours": 60.0,
          "total_pay": 180.00
        }
      ]
    }
  ]
}
```

---

## Admin — Campaigns

> Requires admin Bearer token.

### Create Campaign
```
POST /admin/campaigns/create
```

**Body**
```json
{
  "client_id": 5,
  "program_id": 2620340,
  "hours_bought": 10,
  "bags_bought": 3,
  "start_at": "2026-05-01T00:00:00Z",
  "end_at": "2026-06-01T00:00:00Z",
  "status": "active"
}
```
`start_at` defaults to now. `end_at` defaults to 1 year from start. `bags_bought` is optional.

---

### Get Campaign Status
```
GET /admin/campaigns/status/:campaignId
```
Returns campaign details, playback metrics, and completion percentage.

**Response 200**
```json
{
  "success": true,
  "campaign": {
    "id": 1,
    "client_name": "Acme Corp",
    "program_name": "Spring Promo",
    "status": "active",
    "hours_bought": 10,
    "minutes_bought": 600,
    "start_at": "...",
    "end_at": "...",
    "completed_at": null
  },
  "metrics": {
    "minutes_played": 320,
    "hours_played": 5.33,
    "completion_percent": 53.3,
    "share_of_voice_percent": 100
  },
  "files": {
    "active": 3,
    "removed": 0,
    "total": 3
  }
}
```

---

### List Campaigns
```
GET /admin/campaigns/list?status=active&limit=50&offset=0
```

| Query param | Values |
|-------------|--------|
| `status` | `active` `completed` `paused` `cancelled` `planned` |
| `limit` | number (default 50) |
| `offset` | number (default 0) |

---

### Update Campaign Status
```
PATCH /admin/campaigns/:campaignId/status
```

**Body**
```json
{
  "status": "completed"
}
```
Valid values: `active` `completed` `paused` `cancelled` `planned`

---

### Assign Client to Campaign
```
POST /admin/campaigns/:campaignId/assign-client
```

**Body**
```json
{
  "client_id": 5
}
```

---

### Check Campaign Completions
```
POST /admin/campaigns/check-completions
```
Manually triggers the completion check (normally runs every 5 minutes via cron).

---

## Admin — Media & System

### Sync Media from ColorLight
```
POST /admin/sync-media
POST /admin/media/sync
```
Manually triggers the media sync (normally runs daily at 2am).

---

### Get Sync Status
```
GET /admin/sync-media/status
```

**Response 200**
```json
{
  "success": true,
  "status": {
    "schedule": "Daily at 2:00 AM (via cron)",
    "next_run": "2026-04-19T02:00:00Z",
    "last_sync": "2026-04-18T02:00:00Z"
  }
}
```

---

### Create Share of Voice Snapshot
```
POST /admin/snapshots/create
```

**Body** (optional)
```json
{
  "date": "2026-04-17"
}
```
Defaults to yesterday if no date is provided.

---

### List Programs
```
GET /admin/programs/list
```
Lists all programs with file counts and client breakdowns.

---

### List Clients
```
GET /admin/clients/list
```

---

## Clients

### Check Admin Status
```
GET /clients/me/is-admin
```
Returns the authenticated client's role and admin flag.

---

## Drivers (Admin)

> These routes manage the driver records (applications, assignments). Different from the driver portal.

### List Drivers
```
GET /drivers?status=approved
```
Query param `status`: `pending` `approved` `rejected` `inactive`

### Get Driver
```
GET /drivers/:id
```

### Update Driver Status
```
PATCH /drivers/:id/status
```
**Body:** `{ "status": "approved" }`

### Update Driver Details
```
PUT /drivers/:id
```

### Delete Driver
```
DELETE /drivers/:id
```

### Assign Driver to Terminal
```
POST /drivers/:id/assign
```
**Body:** `{ "terminalId": "SN-001", "notes": "optional" }`

### Unassign Driver from Terminal
```
POST /drivers/:id/unassign
```
**Body:** `{ "terminalId": "SN-001" }`

### Get Current Assignment
```
GET /drivers/:id/current-assignment
```

### Get Assignment History
```
GET /drivers/:id/assignments?startDate=2026-01-01&endDate=2026-04-18
```

### Get Driver Analytics
```
GET /drivers/:id/analytics?startDate=2026-01-01&endDate=2026-04-18
```

### Get All Active Assignments
```
GET /drivers/assignments/active
```

---

## Terminals

### List Terminals
```
GET /terminals
```

### Get Terminal
```
GET /terminals/:id
```

---

## Error Format

All errors follow this shape:
```json
{
  "error": "Human-readable message",
  "details": "Technical details (dev only)"
}
```

Common status codes:
| Code | Meaning |
|------|---------|
| 400 | Bad request — missing or invalid fields |
| 401 | Missing or invalid token |
| 403 | Valid token but not authorized (wrong role, not approved, etc.) |
| 404 | Resource not found |
| 409 | Conflict (e.g. not enough bags available) |
| 500 | Server error |

---

## Environment Variables Required

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # required for admin client creation
CLIENT_EMAIL_DOMAIN=clients.slekto.com
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
DRIVER_HOURLY_RATE=3.00
```
