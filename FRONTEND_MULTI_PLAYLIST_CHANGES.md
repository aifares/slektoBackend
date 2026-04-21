# Frontend — Multi-Playlist Campaign Changes

Work needed on the frontend to consume the new multi-playlist campaign API. Groups the changes by page so you can scope PRs.

**Key concept:** a campaign can now be one of two modes:

- `rotation` (default, existing behavior) — one playlist, images cycle together across all assigned bags.
- `split` — multiple playlists under one campaign, each with its own creatives, bag count, and hours-bought target. Every playlist completes independently; the parent campaign completes only when all of its playlists have completed.

Every campaign response now carries a `mode` field and a `playlists[]` array. Rotation campaigns return a single-entry `playlists` array — the same rendering code can handle both modes if you iterate over `playlists[]` instead of reading the rollup.

---

## 1. Campaign create form

The form needs a **Mode** toggle (radio or tabs): "Single rotating playlist" vs "Multiple playlists under one campaign".

### Rotation mode (default)
No change from today. Fields:

| Field | Type |
|---|---|
| `company_name` | string |
| `start_at` / `end_at` | ISO 8601 |
| `hours_bought` | number |
| `bags_bought` | integer |
| `images` | file[] |

### Split mode
Replace `hours_bought` / `bags_bought` with a **per-playlist editor**. The user adds ≥ 2 playlist rows; each row has:

| Input | Notes |
|---|---|
| `label` | Optional display name, e.g. "Creative A" |
| `bags` | Integer, bags dedicated to this playlist |
| `hours` | Number, hours bought for this playlist |
| `images` | File picker scoped to this playlist (1+ files) |

**Submission (multipart/form-data):**

```
mode=split
playlists=[
  { "label": "Creative A", "bags": 12, "hours": 20, "image_count": 2 },
  { "label": "Creative B", "bags": 5,  "hours": 10, "image_count": 1 },
  { "label": "Creative C", "bags": 5,  "hours": 10, "image_count": 1 }
]
images=<all files, in playlist order>
```

Important: the `images[]` field contains **every file for every playlist, appended in order**. The backend slices them per playlist using `image_count`. So when you build the FormData, iterate playlists in order and append each playlist's files before moving to the next one.

**Client-side validation before submit:**
- At least 2 playlists
- Every playlist has ≥ 1 image, `bags ≥ 1`, `hours > 0`
- Sum of `image_count` equals total images attached
- Sum of `bags` still respects the 25-bag cap (backend will re-check)

**Response shape (201):**
```json
{
  "success": true,
  "campaign": {
    "id": 67,
    "mode": "split",
    "program_id": 2786867,
    "hours_bought": 40,
    "bags_bought": 22,
    "available_bags_after": 3,
    "...": "..."
  },
  "playlists": [
    { "program_id": 2786867, "label": "Creative A", "bags_assigned": 12, "hours_bought": 20, "files_uploaded": 2 },
    { "program_id": 2786868, "label": "Creative B", "bags_assigned": 5,  "hours_bought": 10, "files_uploaded": 1 },
    { "program_id": 2786869, "label": "Creative C", "bags_assigned": 5,  "hours_bought": 10, "files_uploaded": 1 }
  ]
}
```

---

## 2. Campaign list page

Endpoint: `GET /api/v1/campaigns`

Each campaign in the response now has two new fields:

| Field | Type | Usage |
|---|---|---|
| `mode` | `"rotation"` or `"split"` | Show as a small badge |
| `playlist_count` | integer | Show "3 playlists" for split campaigns |

No fields were removed. The existing `program_id`, `hours_bought`, `bags_bought`, `status`, dates, `completed_at` still work as rollups.

---

## 3. Campaign detail / analytics page — **breaking change**

Endpoint: `GET /api/v1/campaigns/:id`

This is the most invasive change. The per-image / per-file / SoV fields used to live on the top-level `analytics` and `files` objects. They've moved into `playlists[]`.

### Fields that **moved** out of the rollup

| Old location | New location |
|---|---|
| `analytics.share_of_voice_percent` | `playlists[].share_of_voice_percent` |
| `analytics.media_urls[]` | `playlists[].media_urls[]` |
| `files.active` / `files.removed` / `files.total` | `playlists[].files.active` / `.removed` / `.total` |

Any frontend code reading those off the rollup will now see `undefined`. Grep for `analytics.share_of_voice_percent`, `analytics.media_urls`, and `response.files` on campaign detail views.

### Rollup `analytics` still provides

- `hours_played` (summed across playlists)
- `minutes_played`
- `hours_bought` (sum)
- `completion_percent` (weighted across playlists)

### New per-playlist fields in `playlists[]`

```jsonc
{
  "id": 101,                              // campaign_playlists row ID
  "program_id": 2786867,
  "program_name": "Acme Corp - 2026-03-01 [Creative A]",
  "label": "Creative A",                  // null for rotation
  "bags_assigned": 12,
  "hours_bought": 20,
  "hours_played": 8.0,
  "minutes_played": 480,
  "completion_percent": 40,
  "share_of_voice_percent": 48.0,
  "media_urls": [ "..." ],
  "completed_at": null,                   // ISO timestamp once this playlist finishes
  "files": { "active": 2, "removed": 0, "total": 2 }
}
```

### Suggested UI layout

- Top card: campaign rollup — name, status, mode badge, overall `hours_played / hours_bought`, overall `completion_percent`, date range.
- Below the rollup: one card per entry in `playlists[]`. Show `label`, `bags_assigned`, per-playlist progress bar, SoV, thumbnails from `media_urls`, file counts, and a "Completed on X" stamp when `completed_at` is set.
- Rotation campaigns will render as one card — treat that as the default shape and rotation is just the `playlists.length === 1` case.

---

## 4. Admin — onboarding flow

New endpoint: `POST /admin/clients/onboard`

One-shot endpoint that replaces the current "create campaign → then create client → then link" dance. Accepts the same mode / playlists shape as the agency endpoint, plus `username` + `password` for the new company login.

Form fields:

| Field | Required | Notes |
|---|---|---|
| `company_name`, `username`, `password` | ✅ | Company account credentials |
| `start_at`, `end_at` | ✅ | Campaign dates |
| `mode` | ❌ | `rotation` (default) or `split` |
| `hours_bought`, `bags_bought` | rotation | As today |
| `playlists` | split | Same JSON shape as the agency endpoint |
| `images[]` | ✅ | In playlist order |

Response includes the same `campaign` + `playlists[]` structure as agency create, plus a `client` object and a `login` block with the username to share with the customer.

---

## 5. Admin — completion-check response

Endpoint: `POST /admin/campaigns/check-completions`

Response **field names changed** — anything displaying these counters needs to update:

| Old | New |
|---|---|
| `campaigns_checked` | `playlists_checked` |
| `campaigns_completed` (meaning "campaigns marked complete on this run") | `playlists_completed` (playlists finished) + `campaigns_completed` (parent campaigns finished) |

New response shape:
```jsonc
{
  "success": true,
  "checked_at": "...",
  "playlists_checked": 4,
  "playlists_completed": 2,
  "campaigns_completed": 1,      // subset: how many parents fully finished
  "completion_results": [
    {
      "campaign_id": 12,
      "playlist_id": 101,
      "program_id": 2786867,
      "playlist_updated": true,
      "campaign_updated": false, // true only when this completion was the last one in the campaign
      "files_removed": 2,
      "snapshot_created": true,
      "errors": []
    }
  ]
}
```

If the admin dashboard displays "X campaigns completed" after a run, consider showing "X playlists completed (Y campaigns fully finished)" instead.

---

## 6. Admin — plain create-campaign endpoint

Endpoint: `POST /admin/campaigns/create` (existing admin endpoint that creates a campaign against an already-uploaded ColorLight program)

No request-shape change. Behind the scenes the backend now also creates a companion `campaign_playlists` row with `mode: "rotation"`, but the API surface is unchanged. If your admin UI uses this endpoint, nothing to do.

---

## 7. Quick checklist

| Area | Change | Breaking? |
|---|---|---|
| Campaign create form | Add rotation/split mode toggle + per-playlist editor | New feature |
| Campaign list | Show `mode` + `playlist_count` | Additive |
| Campaign detail | Rebuild to iterate over `playlists[]` for SoV, media, files | **Yes** |
| Onboarding flow | Switch to `POST /admin/clients/onboard` (optional but recommended) | Additive |
| Completion-check display | Rename counters (`playlists_checked` / `playlists_completed`) | **Yes** |
| Admin create-campaign form | None | — |

---

## 8. Grep targets in the frontend repo

Search for these to find the code that breaks or needs an update:

- `analytics.share_of_voice_percent`
- `analytics.media_urls`
- `campaign.files.active` / `response.files.active` on the campaign detail view
- `campaigns_checked` (response from check-completions)
- Any form handler posting to `/api/v1/campaigns` — needs to support the split-mode branch
- Any form handler posting to the old "create campaign + create client" two-step flow — swap to `/admin/clients/onboard`

---

## 9. Reference

- Agency-facing spec (request/response examples, cURL): [AGENCY_INTEGRATION_GUIDE.md](AGENCY_INTEGRATION_GUIDE.md)
- Admin + system endpoints: [API_DOCS.md](API_DOCS.md)
- Postman collection with both rotation and split requests: [slekto-agency-api.postman_collection.json](slekto-agency-api.postman_collection.json)
