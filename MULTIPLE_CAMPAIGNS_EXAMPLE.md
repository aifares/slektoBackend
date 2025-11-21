# Multiple Campaigns Example

## Scenario: Client with Multiple Campaigns

### Example Client Setup

**Client ID:** 123  
**Client Name:** "Example Client"

### Campaigns in Database

The client has **5 campaigns** total:

1. **Campaign A** (Program 1)

   - Start: 2025-01-01
   - End: 2025-01-31
   - Status: active
   - Hours Bought: 10
   - **Currently Active** ✅

2. **Campaign B** (Program 1)

   - Start: 2025-01-15
   - End: 2025-02-15
   - Status: active
   - Hours Bought: 15
   - **Currently Active** ✅

3. **Campaign C** (Program 1)

   - Start: 2024-12-01
   - End: 2024-12-31
   - Status: completed
   - Hours Bought: 8
   - **Completed** ❌

4. **Campaign D** (Program 2)

   - Start: 2025-01-05
   - End: 2025-01-20
   - Status: active
   - Hours Bought: 8
   - **Currently Active** ✅

5. **Campaign E** (Program 3)
   - Start: 2025-01-10
   - End: 2025-01-25
   - Status: active
   - Hours Bought: 5
   - **Currently Active** ✅

### What Happens in `/analytics` Response

#### Program 1 (Multiple Campaigns)

- **Campaigns A, B, C** all target Program 1
- **Selection Logic:**

  1. Finds active campaigns: Campaign A and Campaign B ✅
  2. Since both are active, selects the **first active one found** (Campaign A)
  3. Campaign C (completed) is ignored
  4. Campaign B is also ignored (only one campaign per program)

- **Result:** Only Campaign A's metrics are shown:
  - Uses Campaign A's time window (2025-01-01 to 2025-01-31)
  - Uses Campaign A's hours_bought (10)
  - Calculates minutes played within Campaign A's window
  - Campaign B and C are not aggregated or shown separately

#### Program 2 (Single Campaign)

- **Campaign D** targets Program 2
- **Result:** Campaign D's metrics are shown normally

#### Program 3 (Single Campaign)

- **Campaign E** targets Program 3
- **Result:** Campaign E's metrics are shown normally

### Response Structure

The response shows:

- `activePrograms: [1, 2, 3]` - All unique program IDs
- `campaign_metrics` - One entry per program (not per campaign)
  - `"1"`: Metrics from Campaign A only
  - `"2"`: Metrics from Campaign D
  - `"3"`: Metrics from Campaign E
- `zone_coverage` - One entry per program
  - `"1"`: Coverage based on Program 1's sessions
  - `"2"`: Coverage based on Program 2's sessions
  - `"3"`: Coverage based on Program 3's sessions

### Key Points

1. **Multiple campaigns per program:** Only ONE campaign is selected per program
2. **Selection priority:**
   - First: Currently active campaign (isActive = true)
   - Second: Most recent campaign that has started
   - Third: Earliest campaign (if none started)
3. **No aggregation:** Campaigns are NOT combined - only one campaign's data is used
4. **Different programs:** Each program gets its own entry in the response

