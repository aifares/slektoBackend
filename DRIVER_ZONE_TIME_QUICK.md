# Driver Zone Time - Quick Reference

## Check How Long a Driver Was in Each Zone

**Endpoint:**

```http
GET /drivers/:driverId/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
Authorization: Bearer <TOKEN>
```

**Example:**

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  'http://localhost:3000/drivers/7/analytics?startDate=2025-11-01&endDate=2025-11-17'
```

**Response:**

```json
{
  "summary": {
    "total_online_hours": 45.5 // Total across all zones
  },
  "zone_breakdown": [
    {
      "zone_display_name": "Times Square",
      "online_hours": 15.0, // Time in THIS zone
      "online_sessions": 12
    },
    {
      "zone_display_name": "Williamsburg",
      "online_hours": 12.0, // Time in THIS zone
      "online_sessions": 8
    }
  ]
}
```

**Key Fields:**

- `total_online_hours` - Total time driver was online (all zones)
- `zone_breakdown[].online_hours` - Time spent in each specific zone
- `online_sessions` - Number of times driver visited that zone

## Compare All Drivers

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  'http://localhost:3000/drivers/analytics/all?startDate=2025-11-01&endDate=2025-11-17'
```

Returns zone breakdown for all drivers, sorted by total online hours.

## How It Works

1. Driver must be assigned to a terminal (use `POST /drivers/:id/assign`)
2. Terminal must be online
3. Terminal must have GPS data with zone information
4. System calculates precise online time from status logs (not GPS approximations)
5. Groups time by zone for the date range

**Note:** Authentication required for all `/drivers` endpoints.
