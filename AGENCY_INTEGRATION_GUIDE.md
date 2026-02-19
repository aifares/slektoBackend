# Slekto Agency API — Integration Guide

This guide walks you through connecting to the Slekto API as a third-party agency. By the end you will be able to:

- Authenticate and receive a token
- Create campaigns on behalf of your clients
- Retrieve a list of all campaigns you have created
- Pull real-time analytics for any specific campaign

A ready-to-import Postman collection is included at the bottom of this guide.

---

## Base URL

```
https://slekto-backend.fly.dev
```

---

## Step 1 — Authenticate

All API requests require a **Bearer token**. Tokens are issued by Supabase and are valid for **1 hour**.

### Request

```
POST https://jwvywdvpnaachfmkjpji.supabase.co/auth/v1/token?grant_type=password
```

**Headers**

| Key | Value |
|---|---|
| `apikey` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3dnl3ZHZwbmFhY2hmbWtqcGppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgzNDIyMTAsImV4cCI6MjA3MzkxODIxMH0.thX8PBQ07SM8ZsFZiEC2jhaM8xUJvX5BiNjH00HNAoI` |
| `Content-Type` | `application/json` |

**Body**

```json
{
  "email": "sample@slekto.com",
  "password": "ZnfDDYyytiRA7g8K"
}
```

### Response

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

Save the `access_token`. You will pass it as `Authorization: Bearer <token>` on every subsequent request.

> **Note:** If you receive a 401 on any request, your token has expired. Repeat this step to get a fresh one.

---

## Step 2 — Create a Campaign

Create a campaign on behalf of one of your clients. Each campaign is tied to your agency account, but identified by the `company_name` you provide.

### Request

```
POST /api/v1/campaigns
```

**Headers**

| Key | Value |
|---|---|
| `Authorization` | `Bearer <your_token>` |
| `Content-Type` | `multipart/form-data` |

**Form Fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `company_name` | string | ✅ | The name of the client company being advertised |
| `start_at` | ISO 8601 | ✅ | Campaign start date/time |
| `end_at` | ISO 8601 | ✅ | Campaign end date/time |
| `hours_bought` | number | ✅ | Total playback hours purchased |
| `bags_bought` | integer | ✅ | Number of ad placements (max 25 across all active campaigns) |
| `images` | file[] | ✅ | 1–20 image files (JPEG, PNG, GIF, BMP, WebP; max 10MB each) |

### Example (cURL)

```bash
TOKEN="eyJ..."

curl -X POST https://slekto-backend.fly.dev/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -F "company_name=Acme Corp" \
  -F "start_at=2026-03-01T00:00:00Z" \
  -F "end_at=2026-03-31T00:00:00Z" \
  -F "hours_bought=10" \
  -F "bags_bought=3" \
  -F "images=@/path/to/ad1.jpg" \
  -F "images=@/path/to/ad2.jpg"
```

### Success Response (201)

```json
{
  "success": true,
  "message": "Campaign created successfully",
  "campaign": {
    "id": 65,
    "client_id": 11,
    "company_name": "Acme Corp",
    "program_id": 2786867,
    "program_name": "Acme Corp - 2026-03-01",
    "hours_bought": 10,
    "bags_bought": 3,
    "start_at": "2026-03-01T00:00:00+00:00",
    "end_at": "2026-03-31T00:00:00+00:00",
    "status": "planned",
    "files_uploaded": 2,
    "available_bags_after": 22
  }
}
```

> **Important:** Save the `campaign.id`. You will use it to retrieve analytics for this specific client.

### Error Responses

| Status | Error | What to do |
|---|---|---|
| 400 | Validation failed | Check all required fields are present and valid |
| 401 | Missing Supabase access token | Re-authenticate (Step 1) |
| 403 | Not authorized to create campaigns | Contact Slekto to enable your account |
| 409 | INSUFFICIENT_BAGS | Reduce `bags_bought` or choose different dates |
| 502 | Failed to upload images | Check image format/size and retry |

---

## Step 3 — List Your Campaigns

Retrieve a list of all campaigns your agency has created. Useful for looking up campaign IDs if you did not store them at creation time.

### Request

```
GET /api/v1/campaigns
```

**Headers**

| Key | Value |
|---|---|
| `Authorization` | `Bearer <your_token>` |

**Optional Query Parameters**

| Param | Description | Example |
|---|---|---|
| `status` | Filter by campaign status | `?status=active` |

Valid status values: `planned`, `active`, `paused`, `completed`, `cancelled`

### Example (cURL)

```bash
# All campaigns
curl https://slekto-backend.fly.dev/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN"

# Only active campaigns
curl "https://slekto-backend.fly.dev/api/v1/campaigns?status=active" \
  -H "Authorization: Bearer $TOKEN"
```

### Success Response (200)

```json
{
  "success": true,
  "count": 2,
  "campaigns": [
    {
      "id": 66,
      "company_name": "Company C",
      "program_id": 2786872,
      "status": "active",
      "start_at": "2026-03-01T00:00:00+00:00",
      "end_at": "2026-03-31T00:00:00+00:00",
      "hours_bought": 20,
      "bags_bought": 3,
      "completed_at": null,
      "created_at": "2026-02-19T21:05:59+00:00"
    },
    {
      "id": 65,
      "company_name": "Acme Corp",
      "program_id": 2786867,
      "status": "completed",
      "start_at": "2026-02-01T00:00:00+00:00",
      "end_at": "2026-02-28T00:00:00+00:00",
      "hours_bought": 10,
      "bags_bought": 3,
      "completed_at": "2026-02-25T14:32:00+00:00",
      "created_at": "2026-01-15T09:00:00+00:00"
    }
  ]
}
```

Campaigns are returned newest first.

---

## Step 4 — Get Campaign Analytics

Pull real-time analytics for a specific campaign using the `id` from Step 2 or Step 3.

### Request

```
GET /api/v1/campaigns/:id
```

**Headers**

| Key | Value |
|---|---|
| `Authorization` | `Bearer <your_token>` |

### Example (cURL)

```bash
curl https://slekto-backend.fly.dev/api/v1/campaigns/65 \
  -H "Authorization: Bearer $TOKEN"
```

### Success Response (200)

```json
{
  "success": true,
  "campaign": {
    "id": 65,
    "company_name": "Acme Corp",
    "program_id": 2786867,
    "program_name": "Acme Corp - 2026-03-01",
    "status": "active",
    "start_at": "2026-03-01T00:00:00+00:00",
    "end_at": "2026-03-31T00:00:00+00:00",
    "completed_at": null,
    "hours_bought": 10,
    "bags_bought": 3
  },
  "analytics": {
    "hours_played": 4.5,
    "minutes_played": 270,
    "hours_bought": 10,
    "completion_percent": 45,
    "share_of_voice_percent": 33.3,
    "media_urls": [
      "https://us33.colorlightcloud.com:443/wp-content/upload/2026/2/ad1.jpg",
      "https://us33.colorlightcloud.com:443/wp-content/upload/2026/2/ad2.jpg"
    ]
  },
  "files": {
    "active": 2,
    "removed": 0,
    "total": 2
  }
}
```

### Analytics Fields Explained

| Field | Description |
|---|---|
| `hours_played` | Total hours this client's ads have been displayed so far |
| `hours_bought` | Total hours purchased |
| `completion_percent` | `hours_played / hours_bought × 100` — how much of the campaign has been delivered |
| `share_of_voice_percent` | The percentage of display time allocated to this client (e.g. if 3 advertisers share a screen equally, this will be ~33.3%) |
| `media_urls` | Direct URLs to the uploaded ad images |
| `files.active` | Number of ad images currently live on the displays |
| `files.removed` | Number of ad images removed (campaign completed) |

### Error Responses

| Status | Error | Meaning |
|---|---|---|
| 400 | Invalid campaign ID | The `:id` in the URL is not a number |
| 404 | Campaign not found | The campaign does not exist, or it belongs to a different agency |

> **Security note:** You can only access campaigns your agency created. Attempting to access another agency's campaign ID returns a `404`, not a `403`.

---

## Campaign Status Reference

| Status | Meaning |
|---|---|
| `planned` | Created but start date has not yet arrived |
| `active` | Currently running on displays |
| `paused` | Temporarily paused by an admin |
| `completed` | All purchased hours have been delivered |
| `cancelled` | Cancelled before completion |

---

## Typical Agency Workflow

```
1. AUTHENTICATE
   POST /auth/v1/token  →  save access_token

2. FOR EACH CLIENT:
   POST /api/v1/campaigns  →  save campaign.id

3. POLL FOR ANALYTICS (e.g. daily):
   GET  /api/v1/campaigns/:id  →  read completion_percent, hours_played

4. IF YOU LOST A CAMPAIGN ID:
   GET  /api/v1/campaigns  →  find it by company_name
```

---

## Postman Collection

Import the file `slekto-agency-api.postman_collection.json` (in the same directory as this guide) into Postman.

### Setup after import

1. Open the **Slekto Agency API** collection
2. Click the collection → **Variables** tab
3. Set `baseUrl` to your server address (default: `http://localhost:3000`)
4. Run **"1. Get Token"** first — it automatically saves the token to the collection variable `{{token}}`
5. All other requests will use `{{token}}` automatically

### Requests included

| # | Request | What it does |
|---|---|---|
| 1 | Get Token | Authenticates and saves token automatically |
| 2 | Create Campaign | Creates a campaign (edit form fields + attach image) |
| 3 | List All Campaigns | Returns all your campaigns |
| 4 | List Active Campaigns | Returns only active campaigns |
| 5 | Get Campaign Analytics | Returns analytics for a specific campaign (set `{{campaignId}}` first) |
