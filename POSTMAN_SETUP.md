# Postman Collection Setup Guide

## 📦 Import the Collection

1. Open Postman
2. Click **Import** button (top left)
3. Select `Client_Data_Endpoints.postman_collection.json`
4. Click **Import**

## 🔑 Setup Authentication

### Step 1: Get Your Auth Token

You have two options to get an authentication token:

#### Option A: Use the Token Generator Script

```bash
cd /Users/alifares/Projects/slektoBackend
node backend/scripts/generateTestToken.js
```

This will output your JWT token. Copy it.

#### Option B: Manual Login via Supabase

If you have production credentials, sign in through your Supabase auth flow and get the JWT token.

### Step 2: Add Authorization Header to Each Request

For each request you want to test:

1. Open the request (e.g., "Get Client Programs")
2. Go to the **Headers** tab
3. Add a new header:
   - **Key:** `Authorization`
   - **Value:** `Bearer YOUR_JWT_TOKEN_HERE` (replace with your actual token)
4. Send the request

**Example:**
```
Key: Authorization
Value: Bearer eyJhbGciOiJIUzI1NiIsImtpZCI6ImN0eVMwekMvZDlGQ2prQWUiLCJ0eXAiOiJKV1QifQ...
```

### Optional: Configure Base URL Variable

1. Click on the **Client Data Endpoints** collection
2. Go to the **Variables** tab
3. Set the `base_url` variable:

| Variable   | Current Value           | Description                          |
| ---------- | ----------------------- | ------------------------------------ |
| `base_url` | `http://localhost:3000` | Change to production URL when needed |

4. Click **Save**

## 📍 Available Endpoints

### 1. **GET /programs**

Returns client's active programs with campaign metrics.

**No query parameters required**

**Response includes:**

- Program details (ID, name, files)
- Campaign metrics (hours played, completion %)
- Thumbnail URLs

---

### 2. **GET /analytics**

Returns terminal analytics and campaign metrics.

**No query parameters required**

**Response includes:**

- Currently playing terminals
- Terminal status (online/offline)
- Summary statistics
- Historical terminal data
- Campaign metrics per program

---

### 3. **GET /client/gps**

Returns GPS data with heatmap visualization.

**Query Parameters (all optional):**

- `gpsDays` - Number of days to look back (default: 7)
- `gpsStartDate` - Start date (YYYY-MM-DD format)
- `gpsEndDate` - End date (YYYY-MM-DD format)
- `gpsProgramId` - Filter by specific program ID

**Examples:**

```
# Last 7 days (default)
GET /client/gps?gpsDays=7

# Custom date range
GET /client/gps?gpsStartDate=2025-09-29&gpsEndDate=2025-10-13

# Filter by program
GET /client/gps?gpsDays=14&gpsProgramId=2389650
```

**Response includes:**

- Latest GPS coordinates per terminal
- Heatmap data with GPS points
- Time distribution (% based on duration)
- Coverage area
- Distance traveled

---

### 4. **GET /clientData** (Legacy)

⚠️ **Deprecated** - Use the three separate endpoints instead.

Returns all data in one response. Maintained for backward compatibility.

---

## 🚀 Testing the Collection

### Quick Test Flow:

1. **Get Programs**

   - Run `GET /programs`
   - Verify you get program list with metrics

2. **Get Analytics**

   - Run `GET /analytics`
   - Check terminal status and campaign metrics

3. **Get GPS Data (7 days)**

   - Run `GET /client/gps?gpsDays=7`
   - See recent GPS tracking

4. **Get GPS Data (Custom Range)**
   - Run `GET /client/gps?gpsStartDate=2025-09-29&gpsEndDate=2025-10-13`
   - See historical GPS data with movement

## 🔄 Switching Environments

### Local Development

```
base_url = http://localhost:3000
```

### Production

```
base_url = https://your-production-domain.com
```

Update the `base_url` variable in the collection settings.

## 📊 Response Examples

All endpoints include example responses in the Postman collection. Click on any request and check the **Examples** section to see sample responses.

## ⚡ Tips

1. **Use Collection Runner** to test all endpoints at once
2. **Save Responses** as examples for documentation
3. **Use Environments** to switch between dev/staging/prod
4. **Add Tests** to validate response structure

## 🐛 Troubleshooting

### 401 Unauthorized

- Check your Authorization header is set correctly
- Ensure format is: `Bearer YOUR_JWT_TOKEN`
- Regenerate token if expired (tokens expire after 1 hour)
- Verify you're using the complete token (should be 3 parts separated by dots)

### 404 Not Found

- Ensure server is running on the correct port
- Check `base_url` variable is correct
- Verify endpoint path is correct

### Empty Data

- Check if client has active campaigns
- Verify terminals are reporting data
- Check date ranges for GPS queries

## 📝 Notes

- **Time Distribution Percentage**: Based on time duration (not distance)
- **Segment Breaks**: GPS points with large time gaps are marked
- **Historical Data**: Includes all terminals that ever played client programs
- **Authentication**: All endpoints require valid JWT token

---

For more details, see `CLIENT_DATA_ENDPOINTS.md`
