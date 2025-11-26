# Driver & Terminal Management API Documentation

Complete guide for managing drivers, terminals, assignments, and analytics.

---

## 📋 Table of Contents

1. [Terminal Endpoints](#terminal-endpoints)
2. [Driver Management](#driver-management)
3. [Driver Assignment](#driver-assignment)
4. [Driver Analytics & Zone Time](#driver-analytics--zone-time)
5. [Complete Examples](#complete-examples)

---

## 🖥️ Terminal Endpoints

### Get All Terminals with Status

```http
GET /status/terminals?includeDrivers=true
Authorization: Bearer <YOUR_TOKEN>
```

**Query Parameters:**

- `includeDrivers` (optional): `true` | `false` - Include driver assignment info

**Response:**

```json
{
  "terminals": [
    {
      "terminalid": "2355209",
      "name": "LED Bag #1",
      "last_report_time": "2025-11-17T10:30:00Z",
      "power_status": "1",
      "led_latest_time": 1763356924,
      "current_status": {
        "is_online": true,
        "status": "online",
        "reason": "online",
        "indicators": {
          "lastReportTime": 1763356924,
          "timeSinceLastReport": 45,
          "threshold": 90,
          "lastReportDate": "2025-11-17T10:30:00Z"
        },
        "last_status_change": "2025-11-17T08:00:00Z",
        "duration_seconds": 9000
      },
      "driver_assignment": {
        "driver": {
          "id": 7,
          "name": "Rubén perebal bocel",
          "phone": "3475587595",
          "email": "rubebocel@gmai.com"
        },
        "assigned_at": "2025-11-17T08:00:00Z",
        "assigned_duration_seconds": 9000,
        "assigned_duration_hours": 2.5,
        "notes": "Morning shift"
      }
    }
  ],
  "total_terminals": 15,
  "online_count": 8,
  "offline_count": 7,
  "terminals_with_drivers": 5
}
```

**Fields Explained:**

- `current_status.is_online`: Boolean - Is the terminal currently online
- `current_status.duration_seconds`: How long the terminal has been in current status
- `driver_assignment`: null if no driver assigned
- `assigned_duration_hours`: How long the driver has been using this terminal

---

### Alternative: Get Terminals from ColorLight API

```http
GET /terminals?includeDrivers=true&includeStatus=true
Authorization: Bearer <YOUR_TOKEN>
```

**Query Parameters:**

- `includeDrivers` (optional): `true` | `false` - Include driver assignment info
- `includeStatus` (optional): `true` | `false` - Include online/offline status
- `skipDbUpdate` (optional): `true` | `false` - Skip database updates

**Response:**

```json
[
  {
    "id": "2355209",
    "title": {
      "rendered": "LED Bag #1"
    },
    "post_meta": {
      "_led_latest_report_time": 1763356924,
      "_led_status": {
        /* ... full status data ... */
      }
    },
    "status_info": {
      "is_online": true,
      "status": "online",
      "reason": "online",
      "last_status_change": "2025-11-17T08:00:00Z",
      "duration_seconds": 9000
    },
    "driver_assignment": {
      "driver": {
        "id": 7,
        "name": "Rubén perebal bocel",
        "phone": "3475587595",
        "email": "rubebocel@gmai.com"
      },
      "assigned_at": "2025-11-17T08:00:00Z",
      "assigned_duration_seconds": 9000,
      "assigned_duration_hours": 2.5,
      "notes": "Morning shift"
    }
  }
]
```

**Difference:**

- `/status/terminals`: Simplified view, always includes status
- `/terminals`: Full raw API data, opt-in for status and drivers

---

## 👤 Driver Management

### Get All Drivers

```http
GET /drivers
```

**No authentication required**

**Response:**

```json
{
  "success": true,
  "count": 7,
  "drivers": [
    {
      "id": 7,
      "name": "Rubén perebal bocel",
      "phone": "3475587595",
      "email": "rubebocel@gmai.com",
      "license_number": "FAKE-LICENSE-123456",
      "address": "417 56 ST",
      "city": "Brooklyn",
      "state": "New York",
      "date_of_birth": "2000-03-28",
      "daily_hours": 10,
      "weekly_hours": 50,
      "status": "pending",
      "created_at": "2025-11-12T05:16:07.858941+00:00"
    }
  ]
}
```

---

### Get Specific Driver

```http
GET /drivers/:id
```

**Example:**

```bash
GET /drivers/7
```

**Response:**

```json
{
  "success": true,
  "driver": {
    "id": 7,
    "name": "Rubén perebal bocel",
    "phone": "3475587595",
    "email": "rubebocel@gmai.com",
    "address": "417 56 ST",
    "city": "Brooklyn",
    "state": "New York",
    "status": "pending"
  }
}
```

---

## 🔗 Driver Assignment

### Assign Driver to Terminal

```http
POST /drivers/:driverId/assign
Content-Type: application/json

{
  "terminalId": "2355209",
  "notes": "Morning shift - Times Square route"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/drivers/7/assign \
  -H "Content-Type: application/json" \
  -d '{
    "terminalId": "2355209",
    "notes": "Morning shift"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "Driver 7 assigned to terminal 2355209",
  "assignment": {
    "id": 1,
    "terminal_id": "2355209",
    "driver_id": 7,
    "assigned_at": "2025-11-17T10:00:00Z",
    "unassigned_at": null,
    "notes": "Morning shift",
    "created_at": "2025-11-17T10:00:00Z"
  }
}
```

**Notes:**

- If terminal already has a driver, it will be automatically unassigned first
- If the same driver is already assigned, returns existing assignment

---

### Unassign Driver from Terminal

```http
POST /drivers/:driverId/unassign
Content-Type: application/json

{
  "terminalId": "2355209"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/drivers/7/unassign \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "2355209"}'
```

**Response:**

```json
{
  "success": true,
  "message": "Driver 7 unassigned from terminal 2355209",
  "assignment": {
    "id": 1,
    "terminal_id": "2355209",
    "driver_id": 7,
    "assigned_at": "2025-11-17T08:00:00Z",
    "unassigned_at": "2025-11-17T12:00:00Z",
    "notes": "Morning shift"
  }
}
```

---

### Get Driver's Current Assignment

```http
GET /drivers/:driverId/current-assignment
```

**Example:**

```bash
GET /drivers/7/current-assignment
```

**Response:**

```json
{
  "success": true,
  "count": 1,
  "assignments": [
    {
      "id": 1,
      "terminal_id": "2355209",
      "driver_id": 7,
      "assigned_at": "2025-11-17T08:00:00Z",
      "unassigned_at": null,
      "notes": "Morning shift",
      "terminals": {
        "terminalid": "2355209",
        "name": "LED Bag #1",
        "group_name": "Fleet A"
      }
    }
  ]
}
```

---

### Get Driver Assignment History

```http
GET /drivers/:driverId/assignments?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

**Query Parameters:**

- `startDate` (optional): Filter from this date
- `endDate` (optional): Filter to this date

**Example:**

```bash
GET /drivers/7/assignments?startDate=2025-11-01&endDate=2025-11-17
```

**Response:**

```json
{
  "success": true,
  "count": 5,
  "assignments": [
    {
      "id": 5,
      "terminal_id": "2355209",
      "driver_id": 7,
      "assigned_at": "2025-11-17T08:00:00Z",
      "unassigned_at": null,
      "notes": "Morning shift",
      "terminals": {
        "terminalid": "2355209",
        "name": "LED Bag #1"
      }
    },
    {
      "id": 4,
      "terminal_id": "2573828",
      "driver_id": 7,
      "assigned_at": "2025-11-16T08:00:00Z",
      "unassigned_at": "2025-11-16T18:00:00Z",
      "notes": "Previous shift",
      "terminals": {
        "terminalid": "2573828",
        "name": "Bag-2"
      }
    }
  ]
}
```

---

### Get All Active Assignments

```http
GET /drivers/assignments/active
```

**Response:**

```json
{
  "success": true,
  "count": 5,
  "assignments": [
    {
      "id": 1,
      "terminal_id": "2355209",
      "driver_id": 7,
      "assigned_at": "2025-11-17T08:00:00Z",
      "unassigned_at": null,
      "drivers": {
        "id": 7,
        "name": "Rubén perebal bocel",
        "phone": "3475587595"
      },
      "terminals": {
        "terminalid": "2355209",
        "name": "LED Bag #1"
      }
    }
  ]
}
```

---

## 📊 Driver Analytics & Zone Time

### Get Complete Driver Analytics (⭐ MAIN ANALYTICS ENDPOINT)

```http
GET /drivers/:driverId/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

**This is the key endpoint for zone time tracking!**

**Query Parameters:**

- `startDate` (required): Start date in format YYYY-MM-DD
- `endDate` (required): End date in format YYYY-MM-DD

**Example:**

```bash
GET /drivers/7/analytics?startDate=2025-11-01&endDate=2025-11-17
```

**Response:**

```json
{
  "success": true,
  "analytics": {
    "driver": {
      "id": 7,
      "name": "Rubén perebal bocel",
      "phone": "3475587595",
      "email": "rubebocel@gmai.com"
    },
    "period": {
      "start_date": "2025-11-01",
      "end_date": "2025-11-17"
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
      },
      {
        "zone_id": 3,
        "zone_name": "soho",
        "zone_display_name": "SoHo",
        "zone_type": "shopping",
        "borough": "Manhattan",
        "online_seconds": 28800,
        "online_hours": 8.0,
        "online_sessions": 6
      }
    ],
    "assignments": [
      {
        "id": 5,
        "terminal_id": "2355209",
        "assigned_at": "2025-11-01T08:00:00Z",
        "unassigned_at": "2025-11-10T18:00:00Z",
        "terminals": {
          "terminalid": "2355209",
          "name": "LED Bag #1"
        }
      },
      {
        "id": 6,
        "terminal_id": "2573828",
        "assigned_at": "2025-11-11T08:00:00Z",
        "unassigned_at": null,
        "terminals": {
          "terminalid": "2573828",
          "name": "Bag-2"
        }
      }
    ]
  }
}
```

**Key Fields:**

- `summary.total_online_hours`: Total time driver was online across all zones
- `zone_breakdown`: Array of zones visited with time spent in each
- `online_hours`: Time spent online in that specific zone
- `online_sessions`: Number of times driver was in that zone

---

### Get Zone Time Breakdown Only

```http
GET /drivers/:driverId/zone-time?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

Same as analytics but returns only the zone breakdown.

**Example:**

```bash
GET /drivers/7/zone-time?startDate=2025-11-01&endDate=2025-11-17
```

**Response:**

```json
{
  "success": true,
  "period": {
    "startDate": "2025-11-01",
    "endDate": "2025-11-17"
  },
  "zones": [
    {
      "zone_id": 1,
      "zone_name": "times_square",
      "zone_display_name": "Times Square",
      "online_hours": 15.0,
      "online_sessions": 12
    }
  ],
  "total_zones": 8
}
```

---

### Get All Drivers Analytics (Compare Drivers)

```http
GET /drivers/analytics/all?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

**Example:**

```bash
GET /drivers/analytics/all?startDate=2025-11-01&endDate=2025-11-17
```

**Response:**

```json
{
  "success": true,
  "period": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-17"
  },
  "total_drivers": 5,
  "drivers": [
    {
      "driver": {
        "id": 7,
        "name": "Rubén perebal bocel"
      },
      "summary": {
        "total_online_hours": 45.5,
        "total_zones_visited": 8
      },
      "zone_breakdown": [
        /* zones */
      ]
    },
    {
      "driver": {
        "id": 6,
        "name": "Juan Jose Rivero"
      },
      "summary": {
        "total_online_hours": 38.2,
        "total_zones_visited": 6
      },
      "zone_breakdown": [
        /* zones */
      ]
    }
  ]
}
```

**Sorted by:** Total online hours (descending) - most active driver first

---

## 📚 Complete Examples

### Example 1: Dashboard Load

**Get everything needed for a dashboard in 2 API calls:**

```javascript
// Call 1: Get all terminals with status and driver assignments
const terminals = await fetch("/status/terminals?includeDrivers=true", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

// Call 2: Get all drivers
const drivers = await fetch("/drivers").then((r) => r.json());

// Now you have:
// - All terminals with online/offline status
// - Which driver is using which terminal
// - How long each driver has been using their terminal
// - All driver information
```

---

### Example 2: Assign Driver Workflow

```javascript
// Step 1: User selects terminal and driver
const terminalId = "2355209";
const driverId = 7;

// Step 2: Assign driver to terminal
const assignment = await fetch(`/drivers/${driverId}/assign`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    terminalId: terminalId,
    notes: "Morning shift - Times Square route",
  }),
}).then((r) => r.json());

console.log(assignment);
// { success: true, message: "Driver 7 assigned to terminal 2355209", ... }

// Step 3: Refresh dashboard to show new assignment
```

---

### Example 3: Get Driver Performance Report

```javascript
// Get driver analytics for the past week
const startDate = "2025-11-10";
const endDate = "2025-11-17";
const driverId = 7;

const analytics = await fetch(
  `/drivers/${driverId}/analytics?startDate=${startDate}&endDate=${endDate}`
).then((r) => r.json());

// Display results
console.log(
  `Total Online: ${analytics.analytics.summary.total_online_hours} hours`
);
console.log("Zone Breakdown:");
analytics.analytics.zone_breakdown.forEach((zone) => {
  console.log(`  ${zone.zone_display_name}: ${zone.online_hours} hours`);
});

// Output:
// Total Online: 45.5 hours
// Zone Breakdown:
//   Times Square: 15.0 hours
//   Williamsburg: 12.0 hours
//   SoHo: 8.0 hours
```

---

### Example 4: Swap Drivers

```javascript
// Scenario: Change driver on a terminal
const terminalId = "2355209";
const oldDriverId = 7;
const newDriverId = 6;

// Step 1: Unassign current driver
await fetch(`/drivers/${oldDriverId}/unassign`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ terminalId }),
});

// Step 2: Assign new driver
await fetch(`/drivers/${newDriverId}/assign`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    terminalId,
    notes: "Afternoon shift",
  }),
});
```

---

### Example 5: Compare All Drivers

```javascript
// Get analytics for all drivers to see who performed best
const analytics = await fetch(
  "/drivers/analytics/all?startDate=2025-11-01&endDate=2025-11-17"
).then((r) => r.json());

// Sort by total online hours (already sorted by API)
const topDrivers = analytics.drivers.slice(0, 3);

topDrivers.forEach((driver, index) => {
  console.log(`#${index + 1}: ${driver.driver.name}`);
  console.log(`   Online: ${driver.summary.total_online_hours} hours`);
  console.log(`   Zones: ${driver.summary.total_zones_visited}`);
});

// Output:
// #1: Rubén perebal bocel
//    Online: 45.5 hours
//    Zones: 8
// #2: Juan Jose Rivero
//    Online: 38.2 hours
//    Zones: 6
```

---

## 🎯 Key Concepts

### How Online Time is Calculated

1. **GPS pings only when terminal is ON** ✅
2. **Status log tracks exact online/offline periods** ✅
3. **Duration is pre-calculated** (not estimated) ✅

**The system:**

- Tracks when terminal goes online/offline
- Calculates exact `duration_seconds` for each status period
- Stores zone_id with each status change
- When you query driver analytics, it:
  - Finds driver's assignments in date range
  - Gets all "online" status periods during those assignments
  - Filters by zone
  - Sums up the `duration_seconds`

**Result:** Precise time tracking per driver per zone! 🎯

---

### Assignment History

- Every assignment is logged with timestamps
- When a driver is unassigned, `unassigned_at` is set
- Current assignments have `unassigned_at = null`
- This creates a complete audit trail

---

### Zone Detection

- Zone is detected from most recent GPS reading
- Stored in `terminal_status_log.zone_id`
- If no GPS data available, zone_id is null
- Analytics only count periods where zone is known

---

## 🚀 Quick Reference

| Want to...                     | Endpoint                                       | Method |
| ------------------------------ | ---------------------------------------------- | ------ |
| See all terminals with drivers | `/status/terminals?includeDrivers=true`        | GET    |
| See all drivers                | `/drivers`                                     | GET    |
| Assign driver to terminal      | `/drivers/:id/assign`                          | POST   |
| Unassign driver                | `/drivers/:id/unassign`                        | POST   |
| Get driver's current terminal  | `/drivers/:id/current-assignment`              | GET    |
| **Get driver zone time** ⭐    | `/drivers/:id/analytics?startDate=X&endDate=Y` | GET    |
| Compare all drivers            | `/drivers/analytics/all?startDate=X&endDate=Y` | GET    |

---

## 🔐 Authentication

- **No Auth Required:** `/drivers/*` (all driver endpoints)
- **Auth Required:** `/status/terminals`, `/terminals`
- **Auth Header:** `Authorization: Bearer <YOUR_TOKEN>`

---

## 💡 Pro Tips

1. **Use `includeDrivers=true`** to get everything in one call
2. **Poll `/status/terminals?includeDrivers=true`** every 30 seconds for real-time dashboard
3. **Cache driver analytics** - zone time doesn't change every second
4. **Use date ranges** - don't query "all time" for better performance
5. **Check `assigned_duration_hours`** to see how long driver has been on current shift

---

## ❓ Common Questions

**Q: How accurate is the zone time tracking?**
A: Very accurate! Uses precise `duration_seconds` from status log, not GPS approximations.

**Q: What if a driver swaps terminals mid-shift?**
A: No problem! Each assignment is tracked separately. Analytics combine all assignments in the date range.

**Q: Can I see historical data?**
A: Yes! Use the `startDate` and `endDate` parameters on analytics endpoints.

**Q: What if GPS data is missing?**
A: Periods without zone data are excluded from zone breakdown, but still counted in total online time.

**Q: How often should I refresh the dashboard?**
A: Every 30-60 seconds is good. Status and assignment duration update in real-time.

---

## 🎉 That's It!

You now have everything needed to:

- ✅ Display terminals with status
- ✅ Show drivers and availability
- ✅ Assign/unassign drivers
- ✅ Track how long drivers use terminals
- ✅ **Get total time drivers spent in each zone** ⭐
- ✅ Compare driver performance

Happy coding! 🚀
