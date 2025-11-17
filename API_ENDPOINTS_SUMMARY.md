# API Endpoints - Driver & Terminal Tracking

## Summary of Features

### ✅ Feature Support:

| Feature | Endpoint | Status |
|---------|----------|--------|
| Show all drivers | `GET /drivers` | ✅ Working (No auth required) |
| Show all terminals with status | `GET /status/terminals?includeDrivers=true` | ✅ Working (Auth required) |
| See drivers using terminals + duration | `GET /status/terminals?includeDrivers=true` | ✅ **NEW - Just Added!** |
| View driver info | `GET /drivers/:id` | ✅ Working (No auth required) |
| View terminal info | `GET /status/terminals/:terminalId` | ✅ Working (Auth required) |
| Assign driver to terminal | `POST /drivers/:id/assign` | ✅ Working (No auth required) |
| Get driver analytics | `GET /drivers/:id/analytics` | ✅ Working (No auth required) |

---

## 1. Get All Drivers

```http
GET /drivers
```

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
      "status": "pending",
      "created_at": "2025-11-12T05:16:07.858941+00:00"
    }
  ]
}
```

---

## 2. Get All Terminals WITH Driver Assignments ⭐ NEW

```http
GET /status/terminals?includeDrivers=true
Authorization: Bearer <YOUR_TOKEN>
```

**Response:**
```json
{
  "terminals": [
    {
      "terminalid": "2355209",
      "name": "LED Bag #1",
      "last_report_time": "2025-11-17T10:30:00Z",
      "power_status": "on",
      "current_status": {
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
  ],
  "total_terminals": 15,
  "online_count": 8,
  "offline_count": 7,
  "terminals_with_drivers": 5
}
```

**Key Data:**
- ✅ Terminal status (online/offline)
- ✅ Current driver assigned
- ✅ How long driver has been using the terminal
- ✅ Driver contact info
- ✅ Assignment notes

---

## 3. Get Terminals WITHOUT Driver Info (Faster)

```http
GET /status/terminals
Authorization: Bearer <YOUR_TOKEN>
```

**Response:**
```json
{
  "terminals": [
    {
      "terminalid": "2355209",
      "name": "LED Bag #1",
      "current_status": {
        "is_online": true,
        "status": "online"
      }
    }
  ],
  "total_terminals": 15,
  "online_count": 8,
  "offline_count": 7
}
```

---

## 4. Get Specific Driver Info

```http
GET /drivers/:id
```

**Example:**
```http
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
    "status": "pending",
    "created_at": "2025-11-12T05:16:07.858941+00:00"
  }
}
```

---

## 5. Get Specific Terminal Info

```http
GET /status/terminals/:terminalId
Authorization: Bearer <YOUR_TOKEN>
```

**Response:**
```json
{
  "terminal": {
    "terminalid": "2355209",
    "name": "LED Bag #1",
    "current_status": {
      "is_online": true,
      "status": "online"
    }
  }
}
```

---

## 6. Assign Driver to Terminal

```http
POST /drivers/:id/assign
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
  -d '{"terminalId": "2355209", "notes": "Morning shift"}'
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
    "notes": "Morning shift"
  }
}
```

---

## 7. Get Driver's Current Assignment

```http
GET /drivers/:id/current-assignment
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

## 8. Get Driver Analytics (Zone Time Breakdown)

```http
GET /drivers/:id/analytics?startDate=2025-11-01&endDate=2025-11-17
```

**Response:**
```json
{
  "success": true,
  "analytics": {
    "driver": {
      "id": 7,
      "name": "Rubén perebal bocel"
    },
    "summary": {
      "total_online_hours": 45.5,
      "total_zones_visited": 8
    },
    "zone_breakdown": [
      {
        "zone_name": "times_square",
        "zone_display_name": "Times Square",
        "online_hours": 15.0,
        "online_sessions": 12
      },
      {
        "zone_name": "williamsburg",
        "zone_display_name": "Williamsburg",
        "online_hours": 12.0,
        "online_sessions": 8
      }
    ]
  }
}
```

---

## Frontend Integration Example

### Display All Terminals with Drivers

```javascript
// Fetch terminals with driver assignments
const response = await fetch('/status/terminals?includeDrivers=true', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();

// Display in your UI
data.terminals.forEach(terminal => {
  console.log(`Terminal: ${terminal.name}`);
  console.log(`Status: ${terminal.current_status.status}`);
  
  if (terminal.driver_assignment) {
    console.log(`Driver: ${terminal.driver_assignment.driver.name}`);
    console.log(`Using for: ${terminal.driver_assignment.assigned_duration_hours} hours`);
  } else {
    console.log(`Driver: Not assigned`);
  }
});
```

---

## Testing Without Auth

The `/drivers` endpoints don't require authentication, so you can test those directly:

```bash
# Get all drivers
curl http://localhost:3000/drivers

# Get driver info
curl http://localhost:3000/drivers/7

# Assign driver to terminal
curl -X POST http://localhost:3000/drivers/7/assign \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "2355209", "notes": "Test assignment"}'

# Get driver's current assignment
curl http://localhost:3000/drivers/7/current-assignment

# Get driver analytics
curl "http://localhost:3000/drivers/7/analytics?startDate=2025-11-01&endDate=2025-11-17"
```

---

## Summary

**Your page should use these endpoints:**

1. **`GET /drivers`** - Get list of all drivers
2. **`GET /status/terminals?includeDrivers=true`** - Get all terminals with status AND current driver assignments
3. **`GET /drivers/:id`** - Get detailed driver info when user clicks on a driver
4. **`GET /status/terminals/:terminalId`** - Get detailed terminal info when user clicks on a terminal

**Key Feature: The `includeDrivers=true` parameter** 
This gives you EVERYTHING in one call:
- ✅ All terminals
- ✅ Online/offline status
- ✅ Which driver is using each terminal
- ✅ How long they've been using it
- ✅ Driver contact info

Perfect for building a dashboard! 🎯

