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

Campaigns support two modes:

- **`rotation`** (default) — a single playlist where all images cycle on every assigned bag.
- **`split`** — multiple playlists under one campaign, each with its own image set, bag count, and hours purchased. Use this when a client wants to dedicate specific bags to specific creatives (e.g. 12 bags for creative A, 5 for creative B, 5 for creative C).

### Request

```
POST /api/v1/campaigns
```

**Headers**

| Key | Value |
|---|---|
| `Authorization` | `Bearer <your_token>` |
| `Content-Type` | `multipart/form-data` |

**Form Fields (shared)**

| Field | Type | Required | Description |
|---|---|---|---|
| `company_name` | string | ✅ | The name of the client company being advertised |
| `start_at` | ISO 8601 | ✅ | Campaign start date/time |
| `end_at` | ISO 8601 | ✅ | Campaign end date/time |
| `mode` | string | ❌ | `rotation` (default) or `split` |
| `images` | file[] | ✅ | Image files (JPEG, PNG, GIF, BMP, WebP; max 10MB each, max 40 total) |

**Rotation-mode fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `hours_bought` | number | ✅ | Total playback hours purchased |
| `bags_bought` | integer | ✅ | Number of ad placements (max 25 across all active campaigns) |

**Split-mode fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `playlists` | JSON string | ✅ | Array of `≥ 2` playlist definitions. See shape below. |

Each playlist entry:
```json
{
  "label": "Creative A",
  "bags": 12,
  "hours": 10,
  "image_count": 2
}
```

- `label` — optional display name shown in the dashboard
- `bags` — bag count dedicated to this playlist
- `hours` — hours purchased for this playlist (metrics + completion are tracked per playlist)
- `image_count` — number of images from the uploaded `images[]` belonging to this playlist. Images are consumed **in upload order**: playlist 0 takes the first `image_count` images, playlist 1 takes the next, and so on. The sum of `image_count` values must equal the number of files you attach.

Total `bags` across all playlists must still fit within the 25-bag cap across active campaigns.

### Example — Rotation (cURL)

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

### Example — Split / Multi-Playlist (cURL)

Four images distributed 12 / 5 / 5 bags across three playlists:

```bash
TOKEN="eyJ..."

curl -X POST https://slekto-backend.fly.dev/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -F "company_name=Acme Corp" \
  -F "start_at=2026-03-01T00:00:00Z" \
  -F "end_at=2026-03-31T00:00:00Z" \
  -F "mode=split" \
  -F 'playlists=[
        {"label":"Creative A","bags":12,"hours":20,"image_count":2},
        {"label":"Creative B","bags":5,"hours":10,"image_count":1},
        {"label":"Creative C","bags":5,"hours":10,"image_count":1}
      ]' \
  -F "images=@/path/to/creativeA_1.jpg" \
  -F "images=@/path/to/creativeA_2.jpg" \
  -F "images=@/path/to/creativeB.jpg" \
  -F "images=@/path/to/creativeC.jpg"
```

Image-to-playlist mapping above:
- `creativeA_1.jpg`, `creativeA_2.jpg` → Creative A (`image_count: 2`)
- `creativeB.jpg` → Creative B (`image_count: 1`)
- `creativeC.jpg` → Creative C (`image_count: 1`)

### Success Response (201)

```json
{
  "success": true,
  "message": "Campaign created successfully",
  "campaign": {
    "id": 65,
    "client_id": 11,
    "company_name": "Acme Corp",
    "mode": "split",
    "program_id": 2786867,
    "program_name": "Acme Corp - 2026-03-01 [Creative A]",
    "hours_bought": 40,
    "bags_bought": 22,
    "start_at": "2026-03-01T00:00:00+00:00",
    "end_at": "2026-03-31T00:00:00+00:00",
    "status": "planned",
    "files_uploaded": 4,
    "available_bags_after": 3
  },
  "playlists": [
    {
      "program_id": 2786867,
      "program_name": "Acme Corp - 2026-03-01 [Creative A]",
      "label": "Creative A",
      "bags_assigned": 12,
      "hours_bought": 20,
      "files_uploaded": 2
    },
    {
      "program_id": 2786868,
      "program_name": "Acme Corp - 2026-03-01 [Creative B]",
      "label": "Creative B",
      "bags_assigned": 5,
      "hours_bought": 10,
      "files_uploaded": 1
    },
    {
      "program_id": 2786869,
      "program_name": "Acme Corp - 2026-03-01 [Creative C]",
      "label": "Creative C",
      "bags_assigned": 5,
      "hours_bought": 10,
      "files_uploaded": 1
    }
  ]
}
```

Rotation-mode responses have the same shape but `mode: "rotation"` and a single-entry `playlists` array.

Top-level `campaign.hours_bought` and `campaign.bags_bought` are **roll-ups** (sums across all playlists) provided for backwards compatibility. Per-playlist numbers live in the `playlists[]` array.

> **Important:** Save the `campaign.id`. You will use it to retrieve analytics for this specific client.

### Error Responses

| Status | Error | What to do |
|---|---|---|
| 400 | Validation failed | Check required fields; in split mode verify `playlists` JSON is valid and `image_count` values sum to the number of files attached |
| 401 | Missing Supabase access token | Re-authenticate (Step 1) |
| 403 | Not authorized to create campaigns | Contact Slekto to enable your account |
| 409 | INSUFFICIENT_BAGS | Reduce bag totals or choose different dates |
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
      "mode": "rotation",
      "program_id": 2786872,
      "status": "active",
      "start_at": "2026-03-01T00:00:00+00:00",
      "end_at": "2026-03-31T00:00:00+00:00",
      "hours_bought": 20,
      "bags_bought": 3,
      "playlist_count": 1,
      "completed_at": null,
      "created_at": "2026-02-19T21:05:59+00:00"
    },
    {
      "id": 65,
      "company_name": "Acme Corp",
      "mode": "split",
      "program_id": 2786867,
      "status": "completed",
      "start_at": "2026-02-01T00:00:00+00:00",
      "end_at": "2026-02-28T00:00:00+00:00",
      "hours_bought": 40,
      "bags_bought": 22,
      "playlist_count": 3,
      "completed_at": "2026-02-25T14:32:00+00:00",
      "created_at": "2026-01-15T09:00:00+00:00"
    }
  ]
}
```

Campaigns are returned newest first. `playlist_count` tells you how many playlists live under the campaign — always `1` for rotation, `≥ 2` for split.

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
    "mode": "split",
    "program_id": 2786867,
    "program_name": "Acme Corp - 2026-03-01 [Creative A]",
    "status": "active",
    "start_at": "2026-03-01T00:00:00+00:00",
    "end_at": "2026-03-31T00:00:00+00:00",
    "completed_at": null,
    "hours_bought": 40,
    "bags_bought": 22
  },
  "analytics": {
    "hours_played": 12.3,
    "minutes_played": 738,
    "hours_bought": 40,
    "completion_percent": 31
  },
  "playlists": [
    {
      "id": 101,
      "program_id": 2786867,
      "program_name": "Acme Corp - 2026-03-01 [Creative A]",
      "label": "Creative A",
      "bags_assigned": 12,
      "hours_bought": 20,
      "hours_played": 8.0,
      "minutes_played": 480,
      "completion_percent": 40,
      "share_of_voice_percent": 48.0,
      "media_urls": [
        "https://us33.colorlightcloud.com:443/wp-content/upload/2026/2/creativeA_1.jpg",
        "https://us33.colorlightcloud.com:443/wp-content/upload/2026/2/creativeA_2.jpg"
      ],
      "completed_at": null,
      "files": { "active": 2, "removed": 0, "total": 2 }
    },
    {
      "id": 102,
      "program_id": 2786868,
      "program_name": "Acme Corp - 2026-03-01 [Creative B]",
      "label": "Creative B",
      "bags_assigned": 5,
      "hours_bought": 10,
      "hours_played": 2.1,
      "minutes_played": 126,
      "completion_percent": 21,
      "share_of_voice_percent": 20.0,
      "media_urls": [
        "https://us33.colorlightcloud.com:443/wp-content/upload/2026/2/creativeB.jpg"
      ],
      "completed_at": null,
      "files": { "active": 1, "removed": 0, "total": 1 }
    },
    {
      "id": 103,
      "program_id": 2786869,
      "program_name": "Acme Corp - 2026-03-01 [Creative C]",
      "label": "Creative C",
      "bags_assigned": 5,
      "hours_bought": 10,
      "hours_played": 2.2,
      "minutes_played": 132,
      "completion_percent": 22,
      "share_of_voice_percent": 20.0,
      "media_urls": [
        "https://us33.colorlightcloud.com:443/wp-content/upload/2026/2/creativeC.jpg"
      ],
      "completed_at": null,
      "files": { "active": 1, "removed": 0, "total": 1 }
    }
  ]
}
```

Rotation-mode campaigns return the same shape with `mode: "rotation"` and a single-entry `playlists` array.

### Analytics Fields Explained

**Campaign-level (`analytics` object)** — roll-ups across every playlist:

| Field | Description |
|---|---|
| `hours_played` | Total hours this client's ads have been displayed, summed across all playlists |
| `hours_bought` | Total hours purchased, summed across all playlists |
| `completion_percent` | Overall `minutes_played / (hours_bought × 60) × 100` |

**Per-playlist (`playlists[]` array)** — tracked independently per playlist:

| Field | Description |
|---|---|
| `label` | Display name you provided (or `null` for rotation mode) |
| `bags_assigned` | Bag count dedicated to this playlist |
| `hours_bought` | Hours purchased for this playlist |
| `hours_played` | Hours delivered so far for this playlist |
| `completion_percent` | Playlist-specific delivery percentage. A playlist completes (and its ads are removed from the displays) when this hits 100%, independent of its siblings. |
| `share_of_voice_percent` | This playlist's share of display time across the bags it shares with other campaigns |
| `media_urls` | Direct URLs to the images uploaded for this playlist |
| `completed_at` | ISO timestamp when this specific playlist completed (or `null`) |
| `files.active` / `files.removed` / `files.total` | File counts for this playlist only |

A split-mode campaign's `status` flips to `completed` only after **all** its playlists have individually completed.

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
| 2 | Create Campaign (Rotation) | Creates a single-playlist rotation campaign (edit form fields + attach images) |
| 3 | Create Campaign (Split / Multi-Playlist) | Creates a multi-playlist campaign; edit the `playlists` JSON and attach images in order |
| 4 | List All Campaigns | Returns all your campaigns |
| 5 | List Active Campaigns | Returns only active campaigns |
| 6 | Get Campaign Analytics | Returns analytics for a specific campaign (set `{{campaignId}}` first) |
