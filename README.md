# Slekto Backend

Backend API for managing digital advertising campaigns on LED display terminals via the ColorLight Cloud platform.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Agency / Admin  │────▶│  Express API │────▶│  Supabase (DB)  │
└─────────────────┘     └──────┬───────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  ColorLight  │
                        │  Cloud API   │
                        └──────────────┘
```

- **Supabase** — PostgreSQL database + JWT authentication
- **ColorLight Cloud** — LED display management platform (media uploads, program/playlist CRUD)
- **Express** — API server with authenticated routes

---

## Getting Started

### Prerequisites

- Node.js v18+
- Supabase project (URL + anon key)
- ColorLight Cloud account

### Install & Run

```bash
npm install
npm run dev     # nodemon (development)
npm start       # production
```

The server starts on `http://localhost:3000`.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | Hardcoded fallback in `backend/config/supabase.js` |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Hardcoded fallback in `backend/config/supabase.js` |
| `AUTO_START_POLLER` | Start adaptive poller on boot | `true` |

---

## Authentication

All authenticated routes use **Supabase JWTs**. The token is extracted from:

1. `Authorization: Bearer <token>` header, or
2. `sb-access-token` cookie

The middleware (`backend/middleware/auth.js`) validates the token via `supabase.auth.getUser()`, then resolves the corresponding `client` row from the database. The `client` object is attached to `req.client`.

### Getting a Token

```bash
curl -X POST "https://<SUPABASE_URL>/auth/v1/token?grant_type=password" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'
```

Returns `{ "access_token": "eyJ...", ... }`. Use this as the Bearer token.

---

## Third-Party Agency API

### `POST /api/v1/campaigns`

Create a new campaign. This is the primary endpoint for third-party agencies.

**Auth:** Bearer token (Supabase JWT). The client must have `permissions.can_create_campaigns = true`.

**Content-Type:** `multipart/form-data`

#### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `company_name` | string | ✅ | Agency/company display name |
| `start_at` | ISO 8601 | ✅ | Campaign start date |
| `end_at` | ISO 8601 | ✅ | Campaign end date |
| `hours_bought` | number | ✅ | Total playback hours purchased |
| `bags_bought` | integer | ✅ | Number of bags/placements (max 25 total across all campaigns) |
| `images` | file[] | ✅ | 1–20 image files (JPEG, PNG, GIF, BMP, WebP; max 10MB each) |

#### Example

```bash
TOKEN="eyJ..."

curl -X POST http://localhost:3000/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -F "company_name=Acme Corp" \
  -F "start_at=2026-03-01T00:00:00Z" \
  -F "end_at=2026-03-31T00:00:00Z" \
  -F "hours_bought=10" \
  -F "bags_bought=5" \
  -F "images=@ad1.jpg" \
  -F "images=@ad2.jpg"
```

#### Success Response (201)

```json
{
  "success": true,
  "message": "Campaign created successfully",
  "campaign": {
    "id": 61,
    "client_id": 9,
    "company_name": "Acme Corp",
    "program_id": 2762705,
    "program_name": "Acme Corp - 2026-03-01",
    "hours_bought": 10,
    "bags_bought": 5,
    "start_at": "2026-03-01T00:00:00+00:00",
    "end_at": "2026-03-31T00:00:00+00:00",
    "status": "planned",
    "files_uploaded": 2,
    "available_bags_after": 20
  }
}
```

#### Error Responses

| Status | Error | Description |
|---|---|---|
| 400 | Validation failed | Missing/invalid fields |
| 401 | Missing Supabase access token | No Bearer token |
| 403 | Not authorized to create campaigns | `can_create_campaigns` not set |
| 409 | INSUFFICIENT_BAGS | Not enough bags available for the requested dates |
| 502 | Failed to upload/create | ColorLight API error |

#### What Happens Internally

1. **Auth** — JWT validated → client resolved
2. **Permission check** — `client.permissions.can_create_campaigns`
3. **Validation** — dates, hours, bags, images
4. **Bag availability** — checks overlapping campaigns against 25-bag limit
5. **Upload images** — pushed to ColorLight media library
6. **Create program** — playlist created on ColorLight with uploaded images
7. **DB inserts** — `programs`, `files`, `campaign` rows created
8. **Compute schedule** — pre-builds playlist transition for when this campaign completes

---

## Admin Routes

All under `/admin`, require Bearer token auth.

### Campaign Management

| Method | Route | Description |
|---|---|---|
| `POST` | `/admin/campaigns/create` | Create campaign (admin version, accepts `bags_bought`) |
| `GET` | `/admin/campaigns/list` | List campaigns (`?status=active&limit=50&offset=0`) |
| `GET` | `/admin/campaigns/status/:id` | Detailed campaign status with completion % |
| `PATCH` | `/admin/campaigns/:id/status` | Update status (`active`, `paused`, `cancelled`, `completed`, `planned`) |
| `POST` | `/admin/campaigns/:id/assign-client` | Reassign campaign to different client |
| `POST` | `/admin/campaigns/check-completions` | Manually trigger completion check |

### Media & Snapshots

| Method | Route | Description |
|---|---|---|
| `POST` | `/admin/media/sync` | Trigger media sync from ColorLight |
| `POST` | `/admin/snapshots/create` | Create Share of Voice snapshot |
| `GET` | `/admin/programs/list` | List programs with file counts |
| `GET` | `/admin/clients/list` | List all clients |

---

## Schedule-Driven Playlist System

When multiple companies share a program (playlist), the system needs to remove a company's images when their campaign completes — without affecting other companies.

### How It Works

1. **At campaign creation** → `computeScheduleForProgram()` pre-builds the playlist state that should exist *after* this campaign's files are removed. This is stored in the `playlist_schedule` table as a ready-to-push JSON payload.

2. **Every 5 minutes** → the `apply_playlist_transitions` cron job runs `monitorAndAutoComplete()`, which:
   - Checks all active campaigns for 100% hour completion
   - For completed campaigns, calls `completeCampaign()` → `applyTransitionForCampaign()`
   - Pushes the pre-built playlist state to ColorLight (single PUT)
   - Marks files as removed in the local DB
   - Creates a Share of Voice snapshot
   - Recomputes the schedule for remaining campaigns

3. **On cancel/pause** → the admin PATCH route recomputes the schedule so remaining transitions stay accurate.

### Why Pre-Compute?

The old approach fetched the program from ColorLight, reverse-engineered which pages to remove, rebuilt the payload, and pushed it back — all at completion time. This was fragile and error-prone.

The new approach computes the "after" state at creation time when all the data is known, stores it, and applies it with a single PUT when the time comes.

---

## Database Schema

Key tables:

| Table | Purpose |
|---|---|
| `client` | Agency/company accounts (linked to Supabase Auth via `user_id`) |
| `campaign` | Campaign records (`client_id`, `program_id`, `hours_bought`, `bags_bought`, dates, status) |
| `programs` | ColorLight programs/playlists |
| `files` | Media files (linked to `program_id` + `client_id`, soft-deleted via `removed_at`) |
| `playlist_schedule` | Pre-computed playlist transitions (JSON payloads ready to push to ColorLight) |
| `playing` | Active playback sessions on terminals |
| `terminals` | LED display terminals |
| `drivers` | Terminal operators |
| `share_of_voice_snapshots` | Daily snapshots of file distribution per program |

### Bag Availability

There are **25 total bags** (physical ad placements). The system enforces this limit by checking all overlapping active/planned campaigns for the requested date range. If the peak daily usage would exceed 25, the request is rejected.

### Migrations

Located in `database/migrations/`. Run them in order against your Supabase database. The latest is `022_playlist_schedule_and_bags.sql`.

---

## Cron Jobs

Defined in `cron/crontab`:

| Schedule | Job | Description |
|---|---|---|
| `* * * * *` | `fetch_gps_live.js` | Poll live GPS data every minute |
| `0 2 * * *` | `sync_media.js` | Sync media metadata from ColorLight (daily 2 AM) |
| `5 2 * * *` | `snapshot_share_of_voice.js` | Create SOV snapshots (daily 2:05 AM) |
| `*/5 * * * *` | `apply_playlist_transitions.js` | Check for completed campaigns, apply transitions (every 5 min) |

---

## Services

| Service | File | Purpose |
|---|---|---|
| **ColorLight** | `backend/services/colorLight.js` | Upload images, create/fetch/update programs on ColorLight |
| **Playlist Schedule** | `backend/services/playlistSchedule.js` | Bag availability, compute/apply playlist transitions |
| **Campaign Completion** | `backend/services/campaignCompletion.js` | Check for 100% campaigns, trigger completion workflow |
| **Campaign Metrics** | `backend/services/campaignMetrics.js` | Calculate playback hours, completion %, share of voice |
| **Media Sync** | `backend/services/mediaSync.js` | Sync media metadata from ColorLight to local DB |
| **SOV Snapshots** | `backend/services/shareOfVoiceSnapshots.js` | Create daily share of voice snapshots |
| **Database** | `backend/services/database.js` | Terminal data, playing records, status tracking |
| **Adaptive Poller** | `backend/services/adaptivePoller.js` | Smart polling for terminal status |

---

## Project Structure

```
slektoBackend/
├── backend/
│   ├── config/
│   │   └── supabase.js            # Supabase client
│   ├── middleware/
│   │   └── auth.js                # JWT auth middleware
│   ├── routes/
│   │   ├── agencyCampaigns.js     # POST /api/v1/campaigns
│   │   ├── adminCampaigns.js      # Admin campaign routes
│   │   ├── campaigns.js           # Client-facing campaign routes
│   │   ├── terminal.js            # Terminal management
│   │   └── ...
│   ├── services/
│   │   ├── colorLight.js          # ColorLight API (upload, programs)
│   │   ├── playlistSchedule.js    # Schedule-driven transitions
│   │   ├── campaignCompletion.js  # Campaign completion logic
│   │   ├── campaignMetrics.js     # Playback metrics
│   │   ├── mediaSync.js           # Media sync from ColorLight
│   │   └── ...
│   ├── jobs/
│   │   ├── apply_playlist_transitions.js
│   │   ├── sync_media.js
│   │   ├── snapshot_share_of_voice.js
│   │   └── fetch_gps_live.js
│   ├── server.js                  # Express app entry point
│   └── utils.js                   # ColorLight auth headers
├── cron/
│   └── crontab                    # Cron job definitions
├── database/
│   ├── schema.sql                 # Full database schema
│   └── migrations/                # Incremental migrations
├── package.json
└── README.md
```
