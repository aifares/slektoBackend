# ClientData API Response Schemas

## Schema 1: Terminal ONLINE (Currently Playing)

```json
{
  "client": {
    "id": "number",
    "name": "string",
    "activePrograms": ["number"]
  },
  "terminals": [
    {
      "terminalId": "string",
      "name": "string | null",
      "group_name": "string | null",
      "last_report_time": "string | null",
      "power_status": "string", // "1" = online, "0" = offline
      "playing": {
        "program_id": "number",
        "program_name": "string",
        "file_name": "string",
        "source": "string", // "internet" | "local"
        "started_at": "string" // ISO timestamp
      },
      "gps": {
        "longitude": "number",
        "latitude": "number",
        "last_updated": "string" // ISO timestamp
      }
    }
  ],
  "summary": {
    "total_terminals": "number", // > 0 when terminals online
    "terminals_playing": "number", // > 0 when playing content
    "terminals_offline": "number", // 0 when all online
    "historical_terminals_count": "number"
  },
  "heatmap": {
    "summary": {
      "totalGpsPoints": "number",
      "programsCount": "number",
      "terminalsCount": "number",
      "dateRange": "string" // "YYYY-MM-DD to YYYY-MM-DD"
    },
    "programs": {
      "[program_id]": {
        "program_id": "number",
        "program_name": "string",
        "points": [
          {
            "latitude": "number",
            "longitude": "number",
            "timestamp": "string", // ISO timestamp
            "terminal_id": "string",
            "intensity": "number" // Always 1.0
          }
        ],
        "totalPoints": "number",
        "coverage": {
          "minLat": "number",
          "maxLat": "number",
          "minLng": "number",
          "maxLng": "number",
          "centerLat": "number",
          "centerLng": "number"
        },
        "density": "string", // "high" | "medium" | "low"
        "avgPointsPerLocation": "number"
      }
    }
  },
  "historical_terminals": [
    {
      "terminal_id": "string",
      "programs_played": [
        {
          "program_id": "number",
          "program_name": "string"
        }
      ],
      "first_played_at": "string", // ISO timestamp
      "last_played_at": "string" // ISO timestamp
    }
  ]
}
```

## Schema 2: Terminal OFFLINE (No Active Terminals)

```json
{
  "client": {
    "id": "number",
    "name": "string",
    "activePrograms": ["number"] // May be empty if no active campaigns
  },
  "terminals": [], // Empty array when no terminals online
  "summary": {
    "total_terminals": 0, // Always 0 when offline
    "terminals_playing": 0, // Always 0 when offline
    "terminals_offline": "number", // May be > 0 if terminals exist but offline
    "historical_terminals_count": "number" // > 0 if historical data exists
  },
  "heatmap": {
    "summary": {
      "totalGpsPoints": "number", // May be 0 or historical data
      "programsCount": "number", // May be 0 or historical data
      "terminalsCount": "number", // May be 0 or historical data
      "dateRange": "string" // "YYYY-MM-DD to YYYY-MM-DD"
    },
    "programs": {} // Empty object or historical data
  },
  "historical_terminals": [
    {
      "terminal_id": "string",
      "programs_played": [
        {
          "program_id": "number",
          "program_name": "string"
        }
      ],
      "first_played_at": "string", // ISO timestamp
      "last_played_at": "string" // ISO timestamp
    }
  ] // May be empty if no historical data
}
```

## Key Differences Between Online/Offline States

### When Terminal is ONLINE:

- ✅ `terminals` array contains terminal objects
- ✅ `power_status` = "1"
- ✅ `playing` object shows current program
- ✅ `gps` object shows real-time location
- ✅ `total_terminals` > 0
- ✅ `terminals_playing` > 0
- ✅ Heatmap shows current + historical data

### When Terminal is OFFLINE:

- ❌ `terminals` array is empty `[]`
- ❌ No `playing` or `gps` data
- ❌ `total_terminals` = 0
- ❌ `terminals_playing` = 0
- ✅ Heatmap may show historical data only
- ✅ `historical_terminals` may contain past data

## Query Parameters (Both States)

- `gpsStartDate` - Start date for GPS data (default: 7 days ago)
- `gpsEndDate` - End date for GPS data (default: today)
- `gpsProgramId` - Filter heatmap by specific program ID
- `gpsDays` - Number of days to look back (default: 7)

## Response Guarantees

✅ **Always includes heatmap** - Even when no terminals are online  
✅ **Always includes historical_terminals** - Shows past terminal activity  
✅ **Consistent structure** - Same fields regardless of terminal state  
✅ **Real-time data** - When terminals are online, shows current status  
✅ **Historical data** - Always shows past GPS and playing history
