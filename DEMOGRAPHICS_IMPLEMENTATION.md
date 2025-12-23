# 📊 Demographics Implementation Guide

## Overview
This guide walks through implementing demographic-enhanced exposure scoring for the analytics endpoint.

**Total Time:** ~1 hour (mostly waiting for Census API)  
**Prerequisites:** Census API key (already configured)

---

## 🚀 Quick Start

### Step 1: Apply Database Migrations (2 minutes)

```bash
# Connect to your database
psql $DATABASE_URL

# Or if using Supabase SQL Editor, run these files:
```

**Run in order:**
1. `database/migrations/020_zone_demographics.sql` - Creates table
2. `database/migrations/021_zone_coverage_demographics_rpc.sql` - Creates RPC function

**Verify:**
```sql
-- Check table exists
SELECT * FROM zone_demographics LIMIT 1;

-- Check RPC exists
SELECT routine_name FROM information_schema.routines 
WHERE routine_name = 'get_zone_coverage_with_demographics';
```

---

### Step 2: Populate Demographics (30-45 minutes)

This fetches Census data for ALL zones (one-time only):

```bash
cd /Users/alifares/Projects/slektoBackend

# Dry run - see what will be processed
node backend/scripts/populateZoneDemographics.js --help

# Run full population (fetches for ~418 zones)
node backend/scripts/populateZoneDemographics.js
```

**Expected output:**
```
═══════════════════════════════════════════════════════════════
   📊 POPULATE ZONE DEMOGRAPHICS
═══════════════════════════════════════════════════════════════

📍 Processing 418 zones...

[1/418] Tribeca... ✅ $250,001 income, 5,787 pop
[2/418] Bay Ridge... ✅ $85,183 income, 3,792 pop
[3/418] SoHo... ✅ $195,000 income, 4,234 pop
...

═══════════════════════════════════════════════════════════════
   📈 SUMMARY
═══════════════════════════════════════════════════════════════

✅ Success: 415
❌ Failed: 3

💾 Demographics stored in zone_demographics table
📅 Next update needed: When Census releases 2024 data

═══════════════════════════════════════════════════════════════
```

**Note:** Script auto-skips zones without GPS data and retries failures.

---

### Step 3: Test RPC Function (2 minutes)

Verify the RPC returns demographics:

```sql
SELECT 
  zone_name,
  total_minutes,
  weighted_exposure,
  (residential_demographics->>'median_income')::int as income,
  (tourist_demographics->>'profile_type') as visitor_type
FROM get_zone_coverage_with_demographics(
  ARRAY[123]::bigint[],  -- Replace with your program ID
  ARRAY[2573828, 2355209]::bigint[],  -- Replace with your terminal IDs
  '2025-12-01'::timestamptz,
  '2025-12-18'::timestamptz,
  10
)
LIMIT 5;
```

**Expected:**
```
   zone_name   | total_minutes | weighted_exposure | income  | visitor_type
---------------+---------------+-------------------+---------+--------------
 Tribeca       |      3240.00  |         9720.00   | 250001  | mixed_visitor
 Bay Ridge     |      2160.00  |         3240.00   |  85183  | local_visitor
```

---

### Step 4: Update Analytics Endpoint (15 minutes)

This is done in the next step, but here's what changes:

**Current code** (in `backend/routes/analytics.js`):
```javascript
// OLD: Manual query for zone coverage
const { data: zoneCoverage } = await buildZoneCoverageMetrics(...);
```

**New code** (will be added):
```javascript
// NEW: RPC with demographics
const { data: zoneCoverage } = await supabase.rpc(
  'get_zone_coverage_with_demographics',
  { ... }
);

// Calculate enhanced exposure (in-memory, fast)
const enhanced = calculateEnhancedExposure(...);
```

---

## 🔄 Ongoing Maintenance

### When to Update Demographics

| Event | Frequency | Command |
|-------|-----------|---------|
| **Initial setup** | Once | `node backend/scripts/populateZoneDemographics.js` |
| **Census releases new data** | Yearly (Sept) | `node backend/scripts/populateZoneDemographics.js --update` |
| **New zones added** | As needed | Runs automatically (skips existing) |
| **Single zone fix** | Rare | `node backend/scripts/populateZoneDemographics.js --zone-id=466` |

### Check Demographics Freshness

```sql
SELECT 
  COUNT(*) as total_zones,
  COUNT(CASE WHEN last_updated_at > NOW() - INTERVAL '1 year' THEN 1 END) as fresh,
  MAX(last_updated_at) as most_recent_update
FROM zone_demographics;
```

---

## 🎯 Usage Examples

### Update Single Zone
```bash
node backend/scripts/populateZoneDemographics.js --zone-id=466
```

### Force Re-fetch All Zones
```bash
node backend/scripts/populateZoneDemographics.js --update
```

### Check What Needs Updating
```bash
# Just run without --update, it auto-detects
node backend/scripts/populateZoneDemographics.js
```

---

## 🐛 Troubleshooting

### Issue: "No GPS data for zone"
**Solution:** Zone has no terminal GPS history. This is OK, skip it or manually add sample coordinates.

### Issue: "Census API returned no data"
**Solution:** GPS coordinates might be outside NYC. Verify zone boundaries.

### Issue: RPC returns NULL for demographics
**Solution:** Run population script first: `node backend/scripts/populateZoneDemographics.js`

### Issue: "Census API rate limit"
**Solution:** Script auto-throttles (150ms between requests). If rate limited, wait 1 hour and retry.

---

## ✅ Verification Checklist

Before deploying to production:

- [ ] Table `zone_demographics` exists
- [ ] RPC function `get_zone_coverage_with_demographics` exists
- [ ] At least 400 zones populated (check `SELECT COUNT(*) FROM zone_demographics`)
- [ ] RPC returns demographics (test query above)
- [ ] Analytics endpoint uses new RPC (Step 4)
- [ ] Response includes `demographics_enhanced_exposure` field
- [ ] Backwards compatibility confirmed (old fields still present)

---

## 📊 Performance Expectations

| Operation | Time | Notes |
|-----------|------|-------|
| Initial population | 30-45 min | One-time, ~418 zones × 150ms |
| Single zone update | ~5 sec | 2 API calls + DB write |
| Analytics with demographics | +50-100ms | Added to existing ~500ms |
| RPC function | 200-300ms | Single query, fast |

---

## 🎉 Next Steps

After completing Steps 1-3:
1. Test RPC function works
2. Update analytics endpoint (Step 4 - separate implementation)
3. Deploy to production
4. Monitor performance
5. Set reminder for next Census data release (September 2024)

---

## 📞 Support

If you encounter issues:
1. Check logs: `tail -f server.log`
2. Verify Census API key: `echo $CENSUS_API_KEY`
3. Test single zone first: `--zone-id=466`
4. Check database connection

Census API Documentation: https://www.census.gov/data/developers/data-sets/acs-5year.html




