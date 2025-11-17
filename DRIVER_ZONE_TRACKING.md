# Driver Zone Tracking Implementation

## Overview

This implementation adds comprehensive driver assignment tracking and zone-based analytics to the system. You can now:

- Assign drivers to terminals (bags) and track assignment history
- See how long each driver was online in each zone
- Get total online time per driver
- Track driver performance across different zones and time periods

## Database Changes

### 1. New Table: `terminal_driver_assignments`

Tracks historical driver-to-terminal assignments:

```sql
- id: Unique assignment ID
- terminal_id: Which terminal (bag)
- driver_id: Which driver
- assigned_at: When assignment started
- unassigned_at: When assignment ended (NULL if currently assigned)
- assigned_by: Who made the assignment
- unassigned_by: Who unassigned
- notes: Optional notes about the assignment
```

### 2. Updated Table: `terminal_status_log`

Added `zone_id` column to denormalize zone data for faster queries:

```sql
- zone_id: References nyc_zones.id (populated from GPS data)
```

### 3. Deprecated Field: `terminals.driver_id`

This field is now deprecated in favor of the historical tracking table. It's kept for backwards compatibility but should not be used in new code.

## SQL Migration Steps

Run these SQL commands in your Supabase SQL editor:

### Step 1: Run the main migration

```sql
-- Execute: database/migrations/005_add_driver_zone_tracking.sql
```

This will:
- Add `zone_id` column to `terminal_status_log`
- Create `terminal_driver_assignments` table
- Create all necessary indexes

### Step 2: (Optional) Backfill existing zone data

```sql
-- Execute: database/migrations/005_backfill_zones.sql
```

This will populate `zone_id` for existing `terminal_status_log` records using GPS data.

**Note:** This can be slow on large datasets. Consider running during off-peak hours.

### Step 3: Verify migration

```sql
SELECT 
  COUNT(*) as total_status_logs,
  COUNT(zone_id) as with_zone,
  COUNT(*) - COUNT(zone_id) as without_zone,
  ROUND(100.0 * COUNT(zone_id) / COUNT(*), 2) as percentage_with_zone
FROM terminal_status_log;
```

## API Endpoints

### Driver Assignment

#### Assign Driver to Terminal
```http
POST /drivers/:driverId/assign
Content-Type: application/json

{
  "terminalId": "TERMINAL_ID",
  "notes": "Optional notes about assignment"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Driver 1 assigned to terminal ABC123",
  "assignment": {
    "id": 1,
    "terminal_id": "ABC123",
    "driver_id": 1,
    "assigned_at": "2025-11-17T10:00:00Z",
    "unassigned_at": null
  }
}
```

#### Unassign Driver from Terminal
```http
POST /drivers/:driverId/unassign
Content-Type: application/json

{
  "terminalId": "TERMINAL_ID"
}
```

#### Get Current Assignment
```http
GET /drivers/:driverId/current-assignment
```

**Response:**
```json
{
  "success": true,
  "count": 1,
  "assignments": [
    {
      "id": 1,
      "terminal_id": "ABC123",
      "driver_id": 1,
      "assigned_at": "2025-11-17T10:00:00Z",
      "unassigned_at": null,
      "terminals": {
        "terminalid": "ABC123",
        "name": "LED Bag 1",
        "group_name": "Fleet A"
      }
    }
  ]
}
```

#### Get Assignment History
```http
GET /drivers/:driverId/assignments?startDate=2025-11-01&endDate=2025-11-15
```

#### Get All Active Assignments
```http
GET /drivers/assignments/active
```

### Driver Analytics

#### Get Comprehensive Driver Analytics
```http
GET /drivers/:driverId/analytics?startDate=2025-11-01&endDate=2025-11-15
```

**Response:**
```json
{
  "success": true,
  "analytics": {
    "driver": {
      "id": 1,
      "name": "John Doe",
      "phone": "+1234567890",
      "email": "john@example.com"
    },
    "period": {
      "start_date": "2025-11-01",
      "end_date": "2025-11-15"
    },
    "summary": {
      "total_online_hours": 45.5,
      "total_online_seconds": 163800,
      "total_zones_visited": 8,
      "terminals_used": 2
    },
    "zone_breakdown": [
      {
        "zone_id": 1,
        "zone_name": "times_square",
        "zone_display_name": "Times Square",
        "zone_type": "tourist",
        "borough": "Manhattan",
        "online_seconds": 54000,
        "online_hours": 15.0,
        "online_sessions": 12
      },
      {
        "zone_id": 2,
        "zone_name": "williamsburg",
        "zone_display_name": "Williamsburg",
        "zone_type": "mixed",
        "borough": "Brooklyn",
        "online_seconds": 43200,
        "online_hours": 12.0,
        "online_sessions": 8
      }
    ],
    "assignments": [
      {
        "id": 1,
        "terminal_id": "ABC123",
        "assigned_at": "2025-11-01T08:00:00Z",
        "unassigned_at": "2025-11-08T18:00:00Z"
      }
    ]
  }
}
```

#### Get Zone Time Breakdown Only
```http
GET /drivers/:driverId/zone-time?startDate=2025-11-01&endDate=2025-11-15
```

#### Get All Drivers Analytics (Comparative)
```http
GET /drivers/analytics/all?startDate=2025-11-01&endDate=2025-11-15
```

**Response:**
```json
{
  "success": true,
  "period": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-15"
  },
  "total_drivers": 5,
  "drivers": [
    {
      "driver": { "id": 1, "name": "John Doe" },
      "summary": { "total_online_hours": 45.5 },
      "zone_breakdown": [...]
    },
    {
      "driver": { "id": 2, "name": "Jane Smith" },
      "summary": { "total_online_hours": 38.2 },
      "zone_breakdown": [...]
    }
  ]
}
```

## How It Works

### Zone Detection
1. When a terminal's status changes (online/offline), the system automatically fetches the most recent GPS zone
2. The `zone_id` is stored in the `terminal_status_log` record
3. This denormalization makes queries much faster

### Time Calculation
1. The system uses the precise `duration_seconds` from `terminal_status_log` (not GPS approximations)
2. Duration is calculated when a status changes - it's the time elapsed since the previous status change
3. When querying driver analytics, the system:
   - Finds all assignments for that driver in the date range
   - Gets all online status logs during those assignments
   - Sums the `duration_seconds` grouped by zone

### Example Query Flow

For "How long was Driver John online in Times Square last week?":

1. Find John's assignments during that week
2. Get all `terminal_status_log` records where:
   - `status = 'online'`
   - `terminal_id` matches John's assignments
   - `status_changed_at` is within assignment period
   - `zone_id` = Times Square's zone ID
3. Sum all `duration_seconds`
4. Result: Total online time in that zone

## Performance Considerations

### Good Performance
- ✅ Queries are optimized with proper indexes
- ✅ Zone data is denormalized (no expensive joins)
- ✅ Direct duration tracking (no calculation on query)

### Potential Issues at Scale
- ⚠️ Very long date ranges may be slow
- ⚠️ Fallback queries (if RPC not available) do multiple joins
- ⚠️ Backfill query can be slow on millions of records

### Optimization Tips
1. Query specific date ranges (not "all time")
2. Consider adding RPC function for zone breakdown (see `driverAnalytics.js` line 54)
3. For very large datasets, consider pre-aggregating daily summaries

## Code Structure

### Services
- `backend/services/statusTracking.js` - Status tracking with zone detection
- `backend/services/driverAssignment.js` - Driver assignment management
- `backend/services/driverAnalytics.js` - Analytics calculations

### Routes
- `backend/routes/drivers.js` - All driver-related endpoints

### Database
- `database/schema.sql` - Updated schema
- `database/migrations/005_add_driver_zone_tracking.sql` - Migration script
- `database/migrations/005_backfill_zones.sql` - Backfill script

## Testing

### 1. Assign a Driver
```bash
curl -X POST http://localhost:3000/drivers/1/assign \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "ABC123", "notes": "Morning shift"}'
```

### 2. Check Assignment
```bash
curl http://localhost:3000/drivers/1/current-assignment
```

### 3. Get Analytics
```bash
curl "http://localhost:3000/drivers/1/analytics?startDate=2025-11-01&endDate=2025-11-15"
```

### 4. Unassign Driver
```bash
curl -X POST http://localhost:3000/drivers/1/unassign \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "ABC123"}'
```

## Common Use Cases

### Scenario 1: Daily Driver Report
"Show me how much time Driver John was online today and where"

```bash
curl "http://localhost:3000/drivers/1/analytics?startDate=2025-11-17&endDate=2025-11-17"
```

### Scenario 2: Weekly Zone Performance
"Which zones did our drivers cover most this week?"

```bash
curl "http://localhost:3000/drivers/analytics/all?startDate=2025-11-10&endDate=2025-11-17"
```

Then aggregate zone_breakdown across all drivers.

### Scenario 3: Driver Swap
"Transfer bag ABC123 from Driver 1 to Driver 2"

```bash
# Unassign Driver 1
curl -X POST http://localhost:3000/drivers/1/unassign \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "ABC123"}'

# Assign Driver 2
curl -X POST http://localhost:3000/drivers/2/assign \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "ABC123", "notes": "Afternoon shift"}'
```

### Scenario 4: Driver Comparison
"Who's the most active driver this month?"

```bash
curl "http://localhost:3000/drivers/analytics/all?startDate=2025-11-01&endDate=2025-11-30"
```

Sort by `summary.total_online_hours` descending.

## Next Steps

1. **Run the SQL migrations** in Supabase
2. **Test the assignment endpoints** with your existing drivers and terminals
3. **Verify zone detection** by checking that new status logs have zone_id populated
4. **Query analytics** for your drivers to see the zone breakdown
5. Consider adding a frontend dashboard to visualize this data

## Support

If you encounter issues:
- Check that migrations ran successfully
- Verify zone_id is being populated in new status logs
- Ensure GPS data has zone_id set
- Review logs for any errors in zone detection

