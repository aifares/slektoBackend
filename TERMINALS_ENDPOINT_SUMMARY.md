# Terminals Endpoint & Poller Summary

## Overview
The `/terminals` endpoint is the primary interface for fetching terminal (LED display) data from the ColorLight Cloud API.

## How It Works

### 1. Endpoint Details
- **Route**: `GET /terminals`
- **Location**: `backend/routes/terminal.js`
- **External API**: `https://us33.colorlightcloud.com/wp-json/wp/v2/leds`
- **Authentication**: Requires Supabase Bearer token

### 2. What the Endpoint Does

When you call `GET /terminals`, it:

1. **Fetches terminal data** from ColorLight Cloud API
2. **Auto-updates the database** (unless `skipDbUpdate=true`)
   - Registers/updates terminal data
   - Updates terminal status (online/offline)
   - Handles playing records (what content is currently displaying)
   - Syncs programs from API
3. **Optionally enhances data** with:
   - Status information (`includeStatus=true`)
   - Driver assignments (`includeDrivers=true`)

### 3. The Adaptive Poller

The adaptive poller (`backend/services/adaptivePoller.js`) automatically calls the ColorLight API at regular intervals:

- **Current Status**: ✅ Running
- **Poll Interval**: ~1,779,204ms (~30 minutes)
- **Error Count**: 0
- **Auto-start**: Enabled by default on server startup

#### Poller Behavior:
- Fetches all terminals from ColorLight API
- Processes and updates database
- Adjusts polling frequency based on terminal activity:
  - HIGH (terminals playing content): More frequent
  - MEDIUM (terminals online): Moderate
  - LOW (all offline): Less frequent (up to 3 minutes)

### 4. Data Retrieved

The ColorLight API returns comprehensive terminal data including:

- **Terminal Info**: ID, name, status, author
- **Hardware Status**: 
  - Power status & last report time
  - Brightness & color temperature
  - Screen dimensions & orientation
  - Board relay status
- **Network Info**:
  - WiFi AP status
  - 4G/LTE connection
  - IP addresses
  - Connection strength
- **Content Info**:
  - Currently playing program/playlist
  - Downloaded programs & files
  - Download status & progress
- **GPS Data**: 
  - Report interval settings
  - Coordinates (if available)
- **System Info**:
  - Memory & storage stats
  - Firmware version
  - Serial number
  - Uptime

### 5. Response Saved

The terminal data has been saved to:
- **File**: `terminals_response.json`
- **Size**: 26KB
- **Format**: JSON array of terminal objects
- **Terminals Found**: 11 terminals in your account

### 6. Key Terminals in Response

1. **Bag-2** (ID: 2573828)
   - Status: ✅ Online
   - Currently Playing: `CityTest2` program
   - Last Report: Recent (within threshold)
   
2. **Terminal1/RedTerm** (ID: 2355209)
   - Status: ✅ Online
   - Currently Playing: `TestNewFormat` program
   - Last Report: Recent (within threshold)

3. **Other Terminals** (Term2, Terminal3936-3949)
   - Most appear to be offline or not reporting data

## Usage Examples

### Fetch all terminals:
```bash
curl -X GET "http://localhost:3000/terminals" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Fetch with status and driver info:
```bash
curl -X GET "http://localhost:3000/terminals?includeStatus=true&includeDrivers=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Fetch specific terminals:
```bash
curl -X GET "http://localhost:3000/terminals?terminalIds=2355209,2573828" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Related Endpoints

The ColorLight API (accessed via `/terminals`) is also used by:
- `/terminals/sleep` - Put terminals to sleep
- `/terminals/wake` - Wake terminals up
- `/terminals/brightness` - Adjust brightness
- `/terminals/gps-reporting` - Configure GPS reporting
- `/terminals/reboot` - Reboot terminals
- `/terminals/powerstatus` - Check power/online status
- `/terminals/register` - Force register terminal data

## Files Generated

1. ✅ `terminals_response.json` - Full terminal data from ColorLight API
2. ✅ `poller_status.json` - Current poller status
3. ✅ `token_new.txt` - Fresh authentication token
4. ✅ This summary document

---

**Generated**: November 23, 2024
**Poller Status**: Running (no errors)
**Terminals Active**: 2 of 11 terminals actively reporting


