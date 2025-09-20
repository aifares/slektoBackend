# Supabase PostgreSQL Integration

This document explains the Supabase PostgreSQL database integration for the LED Terminal management system.

## 🚀 Setup Instructions

### 1. Database Schema Setup

1. Go to your Supabase project: https://jwvywdvpnaachfmkjpji.supabase.co
2. Navigate to the SQL Editor
3. Copy and paste the contents of `database/schema.sql`
4. Execute the SQL to create all tables and indexes

### 2. Environment Configuration

The Supabase configuration is already set up in `backend/config/supabase.js` with your provided credentials:

- **URL**: `https://jwvywdvpnaachfmkjpji.supabase.co`
- **API Key**: Your anon key (already configured)

### 3. Dependencies

The following package has been installed:

- `@supabase/supabase-js` - Supabase JavaScript client

## 📊 Database Schema

The database consists of 7 main tables:

### 1. `drivers`

- Stores driver information (name, phone, email, license)
- Can be manually assigned to terminals

### 2. `terminals`

- Main terminal information (ID, name, description, status)
- Links to drivers and terminal groups
- Stores power status and reporting times

### 3. `programs`

- Program/playlist information for each terminal
- Stores download status and file lists as JSONB

### 4. `files`

- Individual file tracking for programs
- Stores download progress and file metadata

### 5. `playing`

- Currently playing content for each terminal
- Tracks what program/file is currently active

### 6. `device_status`

- Hardware and software status information
- Memory, storage, brightness, volume, etc.

### 7. `connectivity`

- Network and connectivity information
- IP, MAC, WiFi, cellular, GPS status

## 🔌 API Endpoints

### GET `/terminals/`

Fetches terminal data from the ColorLight API and **automatically updates the database** with the latest information.

**Query Parameters:**

- `terminalIds` (optional): Comma-separated terminal IDs or array
- `skipDbUpdate` (optional): Set to `true` to disable automatic database updates

**Examples:**

```bash
# Fetch terminals and auto-update database (default)
GET /terminals/

# Fetch specific terminals and auto-update database
GET /terminals/?terminalIds=2355209,2355210

# Fetch terminals WITHOUT updating database
GET /terminals/?skipDbUpdate=true
```

### POST `/terminals/register`

Manually registers terminal data from the ColorLight API into the Supabase database.

**Request Body:**

```json
{
  "terminalIds": ["2355209"] // Optional, defaults to configured terminal
}
```

**Response:**

```json
{
  "message": "Registration completed for 1 terminal(s)",
  "successful": 1,
  "failed": 0,
  "requestedTerminals": ["2355209"],
  "results": [
    {
      "terminalId": "2355209",
      "success": true,
      "data": {
        "success": true,
        "terminal": {
          /* terminal data */
        },
        "program": {
          /* program data */
        },
        "playing": {
          /* currently playing */
        },
        "deviceStatus": {
          /* device status */
        },
        "connectivity": {
          /* connectivity info */
        },
        "filesCount": 5
      }
    }
  ]
}
```

## 🛠 Database Service

The `DatabaseService` class (`backend/services/database.js`) provides methods for:

- **Terminal Management**: `upsertTerminal()`, `getTerminal()`, `getAllTerminals()`
- **Driver Management**: `upsertDriver()`, `getDriver()`
- **Program Management**: `upsertProgram()`, `getProgramsByTerminal()`
- **File Management**: `upsertFile()`, `batchInsertFiles()`
- **Playing Status**: `upsertPlaying()`, `getCurrentlyPlaying()`
- **Device Status**: `insertDeviceStatus()`, `getLatestDeviceStatus()`
- **Connectivity**: `insertConnectivity()`, `getLatestConnectivity()`
- **Data Processing**: `parseTerminalData()`, `registerTerminalData()`

## 🧪 Testing

### Manual Testing

1. Start the server:

   ```bash
   npm start
   ```

2. Run the test script:
   ```bash
   node test-integration.js
   ```

### API Testing

Use the provided Postman collection or test manually:

```bash
curl -X POST http://localhost:3000/terminals/register \
  -H "Content-Type: application/json" \
  -d '{"terminalIds": ["2355209"]}'
```

## 📋 Data Flow

### Auto-Update Flow (GET `/terminals/`)

1. **API Call**: Client calls `/terminals/` to fetch terminal data
2. **Data Fetch**: System fetches terminal data from ColorLight API
3. **Response**: Terminal data is returned to client immediately
4. **Background Update**: System automatically updates database in parallel (non-blocking)
5. **Database Sync**: Latest terminal data is stored/updated in Supabase

### Manual Registration Flow (POST `/terminals/register`)

1. **API Call**: Client calls `/terminals/register`
2. **Data Fetch**: System fetches terminal data from ColorLight API
3. **Data Parse**: Raw JSON is parsed into database-ready format
4. **Database Insert**: Data is inserted/updated in Supabase tables
5. **Response**: Success/failure status is returned

## 🔍 Data Mapping

The system automatically maps ColorLight API data to database fields:

- `terminal.serialno` → `terminals.id`
- `terminal.name` → `terminals.name`
- `rtc.time` → `terminals.last_report_time`
- `status.*` → `device_status.*` and `connectivity.*`
- `program.*` → `programs.*`
- `playing.*` → `playing.*`

## 🚨 Error Handling

The system includes comprehensive error handling:

- Database connection errors
- Data validation errors
- API fetch errors
- Partial success scenarios (207 Multi-Status responses)

## 🔐 Security Notes

- The anon key is used for database operations
- Consider implementing Row Level Security (RLS) for production
- API endpoints should be secured with authentication in production

## 📈 Performance

- Database indexes are created for optimal query performance
- Batch operations are used for file insertions
- Connection pooling is handled by Supabase client

## 🔄 Future Enhancements

- Add driver assignment functionality
- Implement real-time subscriptions for terminal status
- Add data retention policies
- Implement audit logging
- Add data export functionality
