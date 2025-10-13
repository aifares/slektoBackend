# Client Data Endpoints Documentation

The client data API has been split into three separate endpoints for better organization and performance. Each endpoint focuses on a specific aspect of the client data.

## Authentication

All endpoints require authentication via the `authMiddleware`. The authenticated client is automatically injected into `req.client`.

---

## 1. `/programs` - Program Information

**Purpose:** Returns the client's active programs with campaign metrics and thumbnails.

### Request

```
GET /programs
Authorization: Bearer <token>
```

### Response Structure

```json
{
  "client": {
    "id": 123,
    "name": "Client Name",
    "activePrograms": [1, 2, 3]
  },
  "programs": [
    {
      "id": 1,
      "name": "Program Name",
      "download_status_time": "2023-10-13T12:00:00Z",
      "files": [...],
      "thumbnail_url": "https://...",
      "minutes_played_since_campaign_start": 120,
      "hours_played_since_campaign_start": 2.0,
      "campaign_hours_bought": 100,
      "campaign_minutes_bought": 6000,
      "campaign_completion_percent": 2,
      "campaign_start_at": "2023-10-01T00:00:00Z",
      "campaign_end_at": "2023-10-31T23:59:59Z"
    }
  ]
}
```

### Key Features

- Fetches active campaigns for the client
- Retrieves program details with thumbnails
- Includes campaign playback metrics (minutes played, completion percentage, etc.)
- Returns empty array if no active programs

---

## 2. `/analytics` - Analytics & Metrics

**Purpose:** Returns analytics data including terminal statistics, campaign metrics, and historical data.

### Request

```
GET /analytics
Authorization: Bearer <token>
```

### Response Structure

```json
{
  "client": {
    "id": 123,
    "name": "Client Name",
    "activePrograms": [1, 2, 3]
  },
  "terminals": [
    {
      "terminalId": "TERM123",
      "name": "Terminal Name",
      "group_name": "Group A",
      "last_report_time": "2023-10-13T12:00:00Z",
      "power_status": "on",
      "isOnline": true,
      "playing": {
        "program_id": 1,
        "program_name": "Program Name",
        "file_name": "video.mp4",
        "source": "internet",
        "started_at": "2023-10-13T10:00:00Z"
      }
    }
  ],
  "summary": {
    "total_terminals": 10,
    "terminals_playing": 8,
    "terminals_offline": 2,
    "historical_terminals_count": 50
  },
  "historical_terminals": [
    {
      "terminal_id": "TERM123",
      "programs_played": [
        {
          "program_id": 1,
          "program_name": "Program Name"
        }
      ],
      "first_played_at": "2023-09-01T00:00:00Z",
      "last_played_at": "2023-10-13T12:00:00Z"
    }
  ],
  "campaign_metrics": {
    "1": {
      "minutes_played_since_campaign_start": 120,
      "campaign_completion_percent": 2,
      "campaign_hours_bought": 100,
      "campaign_minutes_bought": 6000,
      "hours_played_since_campaign_start": 2.0,
      "campaign_start_at": "2023-10-01T00:00:00Z",
      "campaign_end_at": "2023-10-31T23:59:59Z"
    }
  }
}
```

### Key Features

- Lists terminals currently playing client's programs
- Includes terminal metadata (name, group, power status, online status)
- Shows what each terminal is currently playing
- Provides summary statistics
- Includes historical terminal data
- Campaign metrics by program ID

---

## 3. `/client/gps` - GPS Data

**Purpose:** Returns GPS data including latest GPS coordinates per terminal and heatmap visualization data.

### Request

```
GET /client/gps?gpsStartDate=2023-10-01&gpsEndDate=2023-10-13&gpsProgramId=1&gpsDays=7
Authorization: Bearer <token>
```

### Query Parameters

- `gpsStartDate` (optional): Start date for GPS data in YYYY-MM-DD format
- `gpsEndDate` (optional): End date for GPS data in YYYY-MM-DD format (defaults to today)
- `gpsDays` (optional): Number of days to look back (default: 7)
- `gpsProgramId` (optional): Filter heatmap data by specific program ID

### Response Structure

```json
{
  "client": {
    "id": 123,
    "name": "Client Name",
    "activePrograms": [1, 2, 3]
  },
  "terminals": [
    {
      "terminalId": "TERM123",
      "gps": {
        "longitude": -74.006,
        "latitude": 40.7128,
        "last_updated": "2023-10-13T12:00:00Z"
      }
    }
  ],
  "heatmap": {
    "summary": {
      "totalGpsPoints": 1000,
      "programsCount": 3,
      "terminalsCount": 10,
      "distanceMiles": 500.5,
      "dateRange": "2023-10-06 to 2023-10-13"
    },
    "programs": {
      "1": {
        "program_id": 1,
        "program_name": "Program Name",
        "points": [
          {
            "latitude": 40.7128,
            "longitude": -74.006,
            "timestamp": "2023-10-13T12:00:00Z",
            "terminal_id": "TERM123",
            "intensity": 0.8
          }
        ],
        "totalPoints": 500,
        "coverage": {
          "minLat": 40.0,
          "maxLat": 41.0,
          "minLng": -75.0,
          "maxLng": -73.0,
          "centerLat": 40.5,
          "centerLng": -74.0
        },
        "density": "high",
        "avgPointsPerLocation": 5.2
      }
    }
  }
}
```

### Key Features

- Latest GPS coordinates for terminals currently playing client's programs
- Heatmap data for all terminals that have historically played client's programs
- Configurable date range for heatmap data
- Optional filtering by program ID
- Coverage area calculations
- Point density metrics
- Includes all historical terminals for comprehensive coverage mapping

---

## Migration from `/clientData`

The original `/clientData` endpoint is still available but can be replaced by these three endpoints:

### Old Approach

```javascript
// Single request with everything
const response = await fetch("/clientData?gpsDays=7");
```

### New Approach (Parallel Requests)

```javascript
// Fetch only what you need
const [programs, analytics, gps] = await Promise.all([
  fetch("/programs"),
  fetch("/analytics"),
  fetch("/client/gps?gpsDays=7"),
]);
```

### Benefits

1. **Better Performance:** Load only the data you need
2. **Reduced Payload:** Smaller response sizes
3. **Better Caching:** Cache strategies can be applied per endpoint
4. **Clearer API:** Each endpoint has a single, clear purpose
5. **Parallel Requests:** Fetch multiple endpoints simultaneously for faster loading

---

## Notes

- The `/gps` endpoint is reserved for terminal GPS data submission (existing route)
- The client-facing GPS endpoint is at `/client/gps` to avoid conflicts
- All endpoints use the same authentication mechanism
- Empty or null values are handled gracefully in all responses
- Historical terminal data is included in GPS endpoint for comprehensive heatmap coverage
