#!/usr/bin/env node

/**
 * Populate Zone Demographics
 * 
 * One-time script to fetch demographics for all zones from Census API
 * and store in zone_demographics table
 * 
 * Usage:
 *   node backend/scripts/populateZoneDemographics.js
 *   node backend/scripts/populateZoneDemographics.js --update  (re-fetch all)
 *   node backend/scripts/populateZoneDemographics.js --zone-id=466  (single zone)
 */

const { supabase } = require("../config/supabase");
const { getTouristProfile } = require("../services/demographics");

// Configuration
const CENSUS_API_KEY = "57cdb8aea88ff7a7af735083aa7fb8f0156c3e6d";
const FCC_GEOCODE_URL = "https://geo.fcc.gov/api/census/block/find";
const CENSUS_ACS5_URL = "https://api.census.gov/data/2022/acs/acs5/profile";

const CENSUS_VARS = {
  NAME: "NAME",
  MEDIAN_INCOME: "DP03_0062E",
  MEDIAN_AGE: "DP05_0018E",
  BACHELORS_PCT: "DP02_0068PE",
  TOTAL_POP: "DP05_0001E",
  EMPLOYMENT_RATE: "DP03_0004PE",
  MGMT_PROF_PCT: "DP03_0027PE",
  AGE_18_24: "DP05_0008PE",
  AGE_25_34: "DP05_0009PE",
  AGE_35_44: "DP05_0010PE",
  AGE_45_54: "DP05_0011PE",
  AGE_55_64: "DP05_0012PE",
  AGE_65_PLUS: "DP05_0013PE",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get Census tract from GPS coordinates
 */
async function getCensusTract(latitude, longitude) {
  const url = `${FCC_GEOCODE_URL}?latitude=${latitude}&longitude=${longitude}&format=json`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK") {
    throw new Error("FCC Geocoding failed");
  }

  const fips = data.Block.FIPS;
  return {
    state: fips.substring(0, 2),
    county: fips.substring(2, 5),
    tract: fips.substring(5, 11),
    fips: fips,
  };
}

/**
 * Get residential demographics from Census API
 */
async function getResidentialDemographics(state, county, tract) {
  const vars = Object.values(CENSUS_VARS).join(",");
  const url = `${CENSUS_ACS5_URL}?get=${vars}&for=tract:${tract}&in=state:${state}&in=county:${county}&key=${CENSUS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data || data.length < 2) {
    throw new Error("Census API returned no data");
  }

  const headers = data[0];
  const values = data[1];
  const result = {};
  headers.forEach((header, i) => {
    result[header] = values[i];
  });

  return {
    area_name: result[CENSUS_VARS.NAME],
    median_income: parseInt(result[CENSUS_VARS.MEDIAN_INCOME]) || 0,
    median_age: parseFloat(result[CENSUS_VARS.MEDIAN_AGE]) || 0,
    bachelors_pct: parseFloat(result[CENSUS_VARS.BACHELORS_PCT]) || 0,
    total_population: parseInt(result[CENSUS_VARS.TOTAL_POP]) || 0,
    employment_rate: parseFloat(result[CENSUS_VARS.EMPLOYMENT_RATE]) || 0,
    mgmt_prof_pct: parseFloat(result[CENSUS_VARS.MGMT_PROF_PCT]) || 0,
    age_distribution: {
      "18-24": parseFloat(result[CENSUS_VARS.AGE_18_24]) || 0,
      "25-34": parseFloat(result[CENSUS_VARS.AGE_25_34]) || 0,
      "35-44": parseFloat(result[CENSUS_VARS.AGE_35_44]) || 0,
      "45-54": parseFloat(result[CENSUS_VARS.AGE_45_54]) || 0,
      "55-64": parseFloat(result[CENSUS_VARS.AGE_55_64]) || 0,
      "65+": parseFloat(result[CENSUS_VARS.AGE_65_PLUS]) || 0,
    },
  };
}

/**
 * Simulate workforce demographics (or fetch from LODES)
 */
function simulateWorkforce(residential) {
  return {
    median_income: Math.floor(residential.median_income * 1.35),
    median_age: Math.max(25, residential.median_age - 2),
    bachelors_pct: Math.min(85, residential.bachelors_pct * 1.2),
    daytime_population: Math.floor(residential.total_population * 2.5),
    mgmt_prof_pct: Math.min(80, residential.mgmt_prof_pct * 1.3),
    age_distribution: {
      "18-24": residential.age_distribution["18-24"] * 0.8,
      "25-34": residential.age_distribution["25-34"] * 1.3,
      "35-44": residential.age_distribution["35-44"] * 1.3,
      "45-54": residential.age_distribution["45-54"] * 1.1,
      "55-64": residential.age_distribution["55-64"] * 0.9,
      "65+": residential.age_distribution["65+"] * 0.3,
    },
  };
}

/**
 * Process a single zone
 */
async function processZone(zone) {
  try {
    // Calculate zone centroid from bounding box (no GPS data needed!)
    let latitude, longitude;
    
    if (zone.min_latitude && zone.max_latitude && zone.min_longitude && zone.max_longitude) {
      // Use bounding box centroid
      latitude = (zone.min_latitude + zone.max_latitude) / 2;
      longitude = (zone.min_longitude + zone.max_longitude) / 2;
    } else {
      // Fallback: try to get from GPS data
      const { data: gpsPoint } = await supabase
        .from("terminal_gps_data")
        .select("latitude, longitude")
        .eq("zone_id", zone.id)
        .limit(1)
        .single();

      if (!gpsPoint) {
        return { success: false, error: "No bounding box or GPS data" };
      }
      latitude = gpsPoint.latitude;
      longitude = gpsPoint.longitude;
    }

    // Get Census tract from centroid coordinates
    const tract = await getCensusTract(latitude, longitude);

    // Get residential demographics from Census
    const residential = await getResidentialDemographics(
      tract.state,
      tract.county,
      tract.tract
    );

    // Simulate workforce (in future, fetch from LODES)
    const workforce = simulateWorkforce(residential);

    // Get zone-specific tourist profile
    const tourist = getTouristProfile(zone.name, zone.zone_type);

    // Validate data - skip zones with bad Census data
    if (residential.median_income < 0 || residential.median_income > 1000000) {
      return { success: false, error: `Invalid income: ${residential.median_income}` };
    }
    
    // Cap values to prevent numeric overflow
    residential.median_income = Math.min(999999, Math.max(0, residential.median_income || 0));
    residential.total_population = Math.min(9999999, Math.max(0, residential.total_population || 0));
    residential.median_age = Math.min(120, Math.max(0, residential.median_age || 35));
    residential.bachelors_pct = Math.min(100, Math.max(0, residential.bachelors_pct || 0));

    // Upsert to database (on conflict: zone_id)
    const { error: upsertError } = await supabase
      .from("zone_demographics")
      .upsert({
        zone_id: zone.id,
        census_tract: tract.tract,
        census_state: tract.state,
        census_county: tract.county,
        census_fips: tract.fips,

        // Residential
        residential_median_income: residential.median_income,
        residential_median_age: residential.median_age,
        residential_bachelors_pct: residential.bachelors_pct,
        residential_population: residential.total_population,
        residential_employment_rate: residential.employment_rate,
        residential_mgmt_prof_pct: residential.mgmt_prof_pct,
        residential_age_dist: residential.age_distribution,

        // Workforce
        workforce_median_income: workforce.median_income,
        workforce_median_age: workforce.median_age,
        workforce_bachelors_pct: workforce.bachelors_pct,
        workforce_daytime_population: workforce.daytime_population,
        workforce_mgmt_prof_pct: workforce.mgmt_prof_pct,
        workforce_age_dist: workforce.age_distribution,

        // Tourist
        tourist_profile_type: tourist.profile_type,
        tourist_median_income: tourist.median_income,
        tourist_median_age: tourist.median_age,
        tourist_bachelors_pct: tourist.bachelors_pct,
        tourist_age_dist: tourist.age_distribution,
        tourist_description: tourist.description,

        // Metadata
        data_quality: "high",
        data_source: "census_acs5_2022",
        last_updated_at: new Date().toISOString(),
        sample_latitude: latitude,
        sample_longitude: longitude,
      }, { onConflict: 'zone_id' });

    if (upsertError) {
      return { success: false, error: upsertError.message };
    }

    return {
      success: true,
      data: {
        income: residential.median_income,
        population: residential.total_population,
        tract: tract.tract,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   📊 POPULATE ZONE DEMOGRAPHICS");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  // Parse command line args
  const args = process.argv.slice(2);
  const isUpdate = args.includes("--update");
  const zoneIdArg = args.find((arg) => arg.startsWith("--zone-id="));
  const specificZoneId = zoneIdArg
    ? parseInt(zoneIdArg.split("=")[1])
    : null;

  // Get zones to process (include bounding box for centroid calculation)
  let query = supabase.from("nyc_zones").select("id, name, zone_type, min_latitude, max_latitude, min_longitude, max_longitude");

  if (specificZoneId) {
    query = query.eq("id", specificZoneId);
    console.log(`🎯 Processing single zone ID: ${specificZoneId}\n`);
  } else if (!isUpdate) {
    // Check which zones already have demographics
    const { data: existingDemographics } = await supabase
      .from("zone_demographics")
      .select("zone_id");

    const existingZoneIds = existingDemographics
      ? existingDemographics.map((d) => d.zone_id)
      : [];

    if (existingZoneIds.length > 0) {
      console.log(
        `ℹ️  Found ${existingZoneIds.length} zones with existing demographics`
      );
      console.log(`   Use --update flag to re-fetch all zones\n`);
      query = query.not("id", "in", `(${existingZoneIds.join(",")})`);
    }
  } else {
    console.log("🔄 Update mode: Re-fetching all zones\n");
  }

  const { data: zones, error: zonesError } = await query.order("name");

  if (zonesError) {
    console.error("❌ Failed to fetch zones:", zonesError.message);
    process.exit(1);
  }

  if (!zones || zones.length === 0) {
    console.log("✅ All zones already have demographics!");
    console.log(
      "   Use --update to refresh, or --zone-id=X for specific zone\n"
    );
    process.exit(0);
  }

  console.log(`📍 Processing ${zones.length} zones...\n`);

  let success = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const progress = `[${i + 1}/${zones.length}]`;

    process.stdout.write(`${progress} ${zone.name}... `);

    const result = await processZone(zone);

    if (result.success) {
      success++;
      console.log(
        `✅ $${result.data.income.toLocaleString()} income, ${result.data.population.toLocaleString()} pop`
      );
    } else {
      failed++;
      console.log(`❌ ${result.error}`);
      failures.push({ zone: zone.name, error: result.error });
    }

    // Rate limit to be nice to Census API (2 requests per zone = 300ms total)
    if (i < zones.length - 1) {
      await sleep(150);
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   📈 SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log("");

  if (failures.length > 0) {
    console.log("Failed zones:");
    failures.forEach((f) => {
      console.log(`   - ${f.zone}: ${f.error}`);
    });
    console.log("");
  }

  if (success > 0) {
    console.log("💾 Demographics stored in zone_demographics table");
    console.log("📅 Next update needed: When Census releases 2024 data");
    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  process.exit(failed > 0 ? 1 : 0);
}

main();


