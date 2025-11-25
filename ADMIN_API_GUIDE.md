# Admin API Guide

Quick reference for the admin interface endpoints.

---

## **📋 Campaign Management**

### **1. Create Campaign**
```
POST /admin/campaigns/create
```

**Body:**
```json
{
  "client_id": 5,
  "program_id": 2620340,
  "hours_bought": 0.0833,  // 5 minutes (hours ÷ 60)
  "status": "active"       // Optional, defaults to "active"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign created successfully",
  "campaign": {
    "id": 8,
    "client_id": 5,
    "client_name": "ali",
    "program_id": 2620340,
    "hours_bought": 0.0833,
    "minutes_bought": 5,
    "status": "active"
  }
}
```

---

### **2. Get Campaign Status**
```
GET /admin/campaigns/status/:campaignId
```

**Response:**
```json
{
  "success": true,
  "campaign": {
    "id": 6,
    "client_id": 5,
    "program_id": 2620340,
    "status": "active",
    "hours_bought": 0.0833
  },
  "metrics": {
    "minutes_played": 3.5,
    "hours_played": 0.058,
    "completion_percent": 70,
    "share_of_voice_percent": 50
  },
  "files": {
    "active": 1,
    "removed": 0,
    "total": 1
  }
}
```

---

### **3. List All Campaigns**
```
GET /admin/campaigns/list?status=active&limit=50&offset=0
```

**Response:**
```json
{
  "success": true,
  "campaigns": [
    {
      "id": 6,
      "client_id": 5,
      "program_id": 2620340,
      "status": "active",
      "start_at": "2025-11-25T20:00:00Z",
      "end_at": "2025-12-02T20:00:00Z",
      "hours_bought": 0.0833,
      "isActive": true
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### **4. Update Campaign Status**
```
PATCH /admin/campaigns/:campaignId/status
```

**Body:**
```json
{
  "status": "active"  // active, completed, paused, cancelled, planned
}
```

---

### **5. Assign Client to Campaign**
```
POST /admin/campaigns/:campaignId/assign-client
```

**Body:**
```json
{
  "client_id": 5
}
```

---

### **6. Check Completions (Force)**
```
POST /admin/campaigns/check-completions
```

Manually triggers completion check. Auto-completes any campaigns at 100%+.

**Response:**
```json
{
  "success": true,
  "results": {
    "campaigns_checked": 5,
    "campaigns_completed": 1,
    "completion_results": [
      {
        "campaign_id": 6,
        "success": true,
        "files_removed": 1,
        "snapshot_created": true
      }
    ]
  }
}
```

---

## **📸 Media & Snapshots**

### **7. Sync Media**
```
POST /admin/media/sync
```

Fetches media from ColorLight, updates client_ids, titles, source_urls.

**Response:**
```json
{
  "success": true,
  "message": "Media sync completed successfully",
  "results": {
    "total_fetched": 23,
    "total_processed": 23,
    "files_with_client_id": 4,
    "upsert_results": {
      "inserted": 2,
      "updated": 20,
      "failed": 0
    },
    "duration_ms": 2105
  }
}
```

---

### **8. Create Snapshot**
```
POST /admin/snapshots/create
```

**Body (optional):**
```json
{
  "date": "2025-11-25"  // Optional, defaults to yesterday
}
```

Manually creates a Share of Voice snapshot for the specified date.

---

## **📊 Reference Data**

### **9. List Programs**
```
GET /admin/programs/list
```

**Response:**
```json
{
  "success": true,
  "programs": [
    {
      "program_id": 2620340,
      "total_files": 2,
      "active_files": 2,
      "removed_files": 0,
      "clients": [
        {
          "client_id": 5,
          "file_count": 1,
          "share_percent": 50
        },
        {
          "client_id": 6,
          "file_count": 1,
          "share_percent": 50
        }
      ]
    }
  ]
}
```

Use this to find program_id and see current file distribution before creating campaigns.

---

### **10. List Clients**
```
GET /admin/clients/list
```

**Response:**
```json
{
  "success": true,
  "clients": [
    {
      "id": 5,
      "name": "ali",
      "email": "ali@gmail.com",
      "created_at": "2025-09-17T19:55:58Z"
    }
  ]
}
```

Use this to get client_id for campaign creation.

---

## **🔧 Typical Workflow**

### **Creating a Test Campaign:**

1. **List Programs** to find a program with files:
   ```
   GET /admin/programs/list
   → Find program 2620340 with 2 active files (50/50 split)
   ```

2. **List Clients** to get client IDs:
   ```
   GET /admin/clients/list
   → Client 5 and Client 6
   ```

3. **Create Campaign A** (5 minutes):
   ```
   POST /admin/campaigns/create
   {
     "client_id": 5,
     "program_id": 2620340,
     "hours_bought": 0.0833  // 5 minutes
   }
   → Campaign ID: 8
   ```

4. **Create Campaign B** (10 minutes):
   ```
   POST /admin/campaigns/create
   {
     "client_id": 6,
     "program_id": 2620340,
     "hours_bought": 0.1667  // 10 minutes
   }
   → Campaign ID: 9
   ```

5. **Monitor Progress:**
   ```
   GET /admin/campaigns/status/8
   → Check completion % every minute
   ```

6. **Force Completion Check** (if needed):
   ```
   POST /admin/campaigns/check-completions
   → Manually trigger auto-complete
   ```

---

## **🔑 Authentication**

All endpoints require a bearer token:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsImtpZCI6...
```

Use the same token from `/analytics` or `/clientData` endpoints.

---

## **📝 Notes**

- **hours_bought** is in decimal hours:
  - 5 minutes = 0.0833 hours
  - 10 minutes = 0.1667 hours
  - 1 hour = 1.0
  
- **status** values: `active`, `completed`, `paused`, `cancelled`, `planned`

- **start_at/end_at** are optional:
  - Defaults: NOW to NOW+7days
  - end_at is a deadline, not when campaign will complete

- **Auto-completion** happens automatically via GPS poller (every minute)
  - Can force with `/admin/campaigns/check-completions`

