#!/usr/bin/env node

/**
 * Demographics Test Script
 *
 * Tests the full demographic profiling flow:
 * 1. Query real GPS data from database
 * 2. Get Census tract from FCC API
 * 3. Fetch residential demographics from Census API
 * 4. Fetch workforce demographics from LODES (simulated for now)
 * 5. Classify zone type from OpenStreetMap
 * 6. Apply time-based weighting
 * 7. Output comprehensive demographic profile
 */

const { supabase } = require("./backend/config/supabase");

// Configuration
const CENSUS_API_KEY = "57cdb8aea88ff7a7af735083aa7fb8f0156c3e6d";
const FCC_GEOCODE_URL = "https://geo.fcc.gov/api/census/block/find";
const CENSUS_ACS5_URL = "https://api.census.gov/data/2022/acs/acs5/profile";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Census variable codes (from https://api.census.gov/data/2022/acs/acs5/profile/variables.html)
const CENSUS_VARS = {
  NAME: "NAME", // Geographic area name
  MEDIAN_INCOME: "DP03_0062E", // Median household income
  MEDIAN_AGE: "DP05_0018E", // Median age
  BACHELORS_PCT: "DP02_0068PE", // Bachelor's degree or higher (%)
  TOTAL_POP: "DP05_0001E", // Total population
  EMPLOYMENT_RATE: "DP03_0004PE", // Employment rate
  MGMT_PROF_PCT: "DP03_0027PE", // Management/professional occupations (%)

  // Age brackets
  AGE_18_24: "DP05_0008PE", // Age 18-24 (%)
  AGE_25_34: "DP05_0009PE", // Age 25-34 (%)
  AGE_35_44: "DP05_0010PE", // Age 35-44 (%)
  AGE_45_54: "DP05_0011PE", // Age 45-54 (%)
  AGE_55_64: "DP05_0012PE", // Age 55-64 (%)
  AGE_65_PLUS: "DP05_0013PE", // Age 65+ (%)
};

// Generic tourist demographics (from NYC tourism statistics)
const TOURIST_PROFILE = {
  median_income: 75000,
  median_age: 38,
  bachelors_pct: 50,
  age_distribution: {
    "18-24": 15,
    "25-34": 30,
    "35-44": 25,
    "45-54": 15,
    "55-64": 10,
    "65+": 5,
  },
  profile_type: "tourist/visitor",
};

/**
 * Step 1: Get GPS data from database
 */
async function getGPSData() {
  console.log("📍 STEP 1: Fetching GPS data from database...\n");

  const { data, error } = await supabase
    .from("terminal_gps_data")
    .select(
      `
      id,
      terminal_id,
      latitude,
      longitude,
      recorded_at,
      zone_id
    `
    )
    .not("zone_id", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new Error(
      "Failed to fetch GPS data: " + (error?.message || "No data found")
    );
  }

  // Get zone info
  const { data: zone } = await supabase
    .from("nyc_zones")
    .select(
      "id, name, display_name, zone_type, min_latitude, max_latitude, min_longitude, max_longitude"
    )
    .eq("id", data[0].zone_id)
    .single();

  const result = { ...data[0], zone };

  console.log(`   Terminal: ${result.terminal_id}`);
  console.log(`   Location: ${result.latitude}, ${result.longitude}`);
  console.log(
    `   Zone: ${result.zone?.display_name || "Unknown"} (${
      result.zone?.zone_type || "unknown"
    })`
  );
  console.log(`   Time: ${new Date(result.recorded_at).toLocaleString()}`);
  console.log("");

  return result;
}

/**
 * Step 2: Get Census tract from GPS coordinates
 */
async function getCensusTract(latitude, longitude) {
  console.log("🗺️  STEP 2: Getting Census tract from FCC API...\n");

  const url = `${FCC_GEOCODE_URL}?latitude=${latitude}&longitude=${longitude}&format=json`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK") {
    throw new Error("FCC Geocoding failed: " + JSON.stringify(data));
  }

  const fips = data.Block.FIPS;
  const state = fips.substring(0, 2);
  const county = fips.substring(2, 5);
  const tract = fips.substring(5, 11);

  console.log(`   County: ${data.County.name}`);
  console.log(`   State Code: ${state}`);
  console.log(`   County Code: ${county}`);
  console.log(`   Tract Code: ${tract}`);
  console.log(`   Full FIPS: ${fips}`);
  console.log("");

  return { state, county, tract, fips, countyName: data.County.name };
}

/**
 * Step 3: Get residential demographics from Census API
 */
async function getResidentialDemographics(state, county, tract) {
  console.log(
    "🏘️  STEP 3: Fetching residential demographics from Census API...\n"
  );

  const vars = Object.values(CENSUS_VARS).join(",");
  const url = `${CENSUS_ACS5_URL}?get=${vars}&for=tract:${tract}&in=state:${state}&in=county:${county}&key=${CENSUS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data || data.length < 2) {
    throw new Error("Census API returned no data");
  }

  // Parse response (first row is headers, second row is data)
  const headers = data[0];
  const values = data[1];
  const result = {};
  headers.forEach((header, i) => {
    result[header] = values[i];
  });

  const demographics = {
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
    profile_type: "residential",
  };

  console.log(`   Area: ${demographics.area_name}`);
  console.log(
    `   Median Income: $${demographics.median_income.toLocaleString()}`
  );
  console.log(`   Median Age: ${demographics.median_age} years`);
  console.log(`   Bachelor's+: ${demographics.bachelors_pct}%`);
  console.log(
    `   Total Population: ${demographics.total_population.toLocaleString()}`
  );
  console.log(`   Employment Rate: ${demographics.employment_rate}%`);
  console.log(`   Professional/Mgmt: ${demographics.mgmt_prof_pct}%`);
  console.log("   Age Distribution:");
  Object.entries(demographics.age_distribution).forEach(([range, pct]) => {
    console.log(`      ${range}: ${pct.toFixed(1)}%`);
  });
  console.log("");

  return demographics;
}

/**
 * Step 4: Get workforce demographics (simulated - would use LODES data)
 */
async function getWorkforceDemographics(state, county, tract, residential) {
  console.log("💼 STEP 4: Estimating workforce demographics...\n");
  console.log(
    "   Note: Using simulated data. In production, would fetch from LODES API.\n"
  );

  // Simulate higher-income workers commuting in for business districts
  // In reality, you'd fetch from https://lehd.ces.census.gov/data/
  const workforce = {
    daytime_workers: Math.floor(residential.total_population * 2.5), // Tribeca has lots of offices
    median_income: Math.floor(residential.median_income * 1.35), // Workers tend to earn more
    median_age: residential.median_age - 2, // Workforce skews slightly younger
    bachelors_pct: Math.min(85, residential.bachelors_pct * 1.2), // Higher education in workforce
    mgmt_prof_pct: Math.min(80, residential.mgmt_prof_pct * 1.3),
    age_distribution: {
      "18-24": residential.age_distribution["18-24"] * 0.8,
      "25-34": residential.age_distribution["25-34"] * 1.3,
      "35-44": residential.age_distribution["35-44"] * 1.3,
      "45-54": residential.age_distribution["45-54"] * 1.1,
      "55-64": residential.age_distribution["55-64"] * 0.9,
      "65+": residential.age_distribution["65+"] * 0.3,
    },
    profile_type: "workforce",
  };

  console.log(
    `   Est. Daytime Workers: ${workforce.daytime_workers.toLocaleString()}`
  );
  console.log(`   Median Income: $${workforce.median_income.toLocaleString()}`);
  console.log(`   Median Age: ${workforce.median_age} years`);
  console.log(`   Bachelor's+: ${workforce.bachelors_pct.toFixed(1)}%`);
  console.log(`   Professional/Mgmt: ${workforce.mgmt_prof_pct.toFixed(1)}%`);
  console.log("");

  return workforce;
}

/**
 * Step 5: Classify zone by querying OpenStreetMap POIs
 */
async function classifyZoneFromOSM(latitude, longitude, zoneType) {
  console.log("🏢 STEP 5: Classifying zone from OpenStreetMap POIs...\n");

  // Query for business POIs within 500m radius
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="bank"](around:500,${latitude},${longitude});
      node["office"](around:500,${latitude},${longitude});
      node["shop"="mall"](around:500,${latitude},${longitude});
      node["tourism"](around:500,${latitude},${longitude});
    );
    out count;
  `;

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      body: query,
      headers: { "Content-Type": "text/plain" },
    });

    const data = await response.json();
    const totalPOIs = data.elements?.length || 0;

    console.log(`   POIs found nearby: ${totalPOIs}`);
    console.log(`   Zone type from DB: ${zoneType}`);

    // Classify based on zone type and POI density
    let classification = {
      type: zoneType || "mixed",
      poi_count: totalPOIs,
      description: "Mixed residential/commercial",
    };

    if (zoneType === "business" || totalPOIs > 50) {
      classification.type = "business";
      classification.description = "Business district with high office density";
    } else if (zoneType === "tourist" || totalPOIs > 30) {
      classification.type = "tourist";
      classification.description = "Tourist/shopping area";
    } else if (zoneType === "residential") {
      classification.type = "residential";
      classification.description = "Primarily residential area";
    }

    console.log(`   Classification: ${classification.type}`);
    console.log(`   Description: ${classification.description}`);
    console.log("");

    return classification;
  } catch (error) {
    console.log(
      `   ⚠️  OSM query failed (${error.message}), using zone type from DB`
    );
    console.log("");
    return {
      type: zoneType || "mixed",
      poi_count: 0,
      description: "Classification based on zone database",
    };
  }
}

/**
 * Step 6: Calculate weighted demographics based on time and zone
 */
function calculateWeightedDemographics(
  residential,
  workforce,
  tourist,
  timestamp,
  zoneType
) {
  console.log("⚖️  STEP 6: Calculating weighted audience demographics...\n");

  const date = new Date(timestamp);
  const hour = date.getHours();
  const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isBusinessHours = hour >= 9 && hour <= 18;

  console.log(`   Time Context:`);
  console.log(
    `      Day: ${
      [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][dayOfWeek]
    }`
  );
  console.log(`      Hour: ${hour}:00`);
  console.log(`      Weekday: ${isWeekday ? "Yes" : "No"}`);
  console.log(`      Business Hours: ${isBusinessHours ? "Yes" : "No"}`);
  console.log("");

  // Calculate weights based on zone type and time
  let weights = { residential: 0.4, workforce: 0.4, tourist: 0.2 };

  if (zoneType === "business" && isWeekday && isBusinessHours) {
    weights = { residential: 0.05, workforce: 0.85, tourist: 0.1 };
    console.log(
      `   Applied Rule: Business district during weekday business hours`
    );
  } else if (zoneType === "business" && (!isWeekday || !isBusinessHours)) {
    weights = { residential: 0.3, workforce: 0.2, tourist: 0.5 };
    console.log(`   Applied Rule: Business district during off hours`);
  } else if (zoneType === "tourist") {
    if (hour >= 10 && hour <= 20) {
      weights = { residential: 0.1, workforce: 0.2, tourist: 0.7 };
      console.log(`   Applied Rule: Tourist area during peak hours`);
    } else {
      weights = { residential: 0.4, workforce: 0.1, tourist: 0.5 };
      console.log(`   Applied Rule: Tourist area during off-peak hours`);
    }
  } else if (zoneType === "residential") {
    if (isWeekday && isBusinessHours) {
      weights = { residential: 0.3, workforce: 0.4, tourist: 0.3 };
      console.log(
        `   Applied Rule: Residential during weekday (mixed with workers/shoppers)`
      );
    } else {
      weights = { residential: 0.7, workforce: 0.1, tourist: 0.2 };
      console.log(`   Applied Rule: Residential during evening/weekend`);
    }
  } else {
    console.log(`   Applied Rule: Mixed zone - balanced weights`);
  }

  console.log("");
  console.log(`   Audience Mix:`);
  console.log(`      Residents: ${(weights.residential * 100).toFixed(0)}%`);
  console.log(`      Workers: ${(weights.workforce * 100).toFixed(0)}%`);
  console.log(
    `      Tourists/Visitors: ${(weights.tourist * 100).toFixed(0)}%`
  );
  console.log("");

  // Calculate weighted values
  const weighted = {
    median_income: Math.round(
      residential.median_income * weights.residential +
        workforce.median_income * weights.workforce +
        tourist.median_income * weights.tourist
    ),
    median_age: (
      residential.median_age * weights.residential +
      workforce.median_age * weights.workforce +
      tourist.median_age * weights.tourist
    ).toFixed(1),
    bachelors_pct: (
      residential.bachelors_pct * weights.residential +
      workforce.bachelors_pct * weights.workforce +
      tourist.bachelors_pct * weights.tourist
    ).toFixed(1),
    age_distribution: {},
    weights: weights,
  };

  // Weight age distribution
  const ageRanges = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  for (const range of ageRanges) {
    weighted.age_distribution[range] = (
      residential.age_distribution[range] * weights.residential +
      workforce.age_distribution[range] * weights.workforce +
      tourist.age_distribution[range] * weights.tourist
    ).toFixed(1);
  }

  // Find primary age group
  let maxPct = 0;
  let primaryAge = "";
  for (const [range, pct] of Object.entries(weighted.age_distribution)) {
    if (parseFloat(pct) > maxPct) {
      maxPct = parseFloat(pct);
      primaryAge = range;
    }
  }
  weighted.primary_age_group = primaryAge;

  return weighted;
}

/**
 * Main execution
 */
async function main() {
  console.log("\n");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("   🎯 DEMOGRAPHIC PROFILING TEST SCRIPT");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("");

  try {
    // Step 1: Get GPS data
    const gpsData = await getGPSData();

    // Step 2: Get census tract
    const tract = await getCensusTract(gpsData.latitude, gpsData.longitude);

    // Step 3: Get residential demographics
    const residential = await getResidentialDemographics(
      tract.state,
      tract.county,
      tract.tract
    );

    // Step 4: Get workforce demographics
    const workforce = await getWorkforceDemographics(
      tract.state,
      tract.county,
      tract.tract,
      residential
    );

    // Step 5: Classify zone
    const zoneClass = await classifyZoneFromOSM(
      gpsData.latitude,
      gpsData.longitude,
      gpsData.zone?.zone_type
    );

    // Step 6: Calculate weighted demographics
    const weighted = calculateWeightedDemographics(
      residential,
      workforce,
      TOURIST_PROFILE,
      gpsData.recorded_at,
      zoneClass.type
    );

    // Final Summary
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log("   📊 FINAL AUDIENCE PROFILE");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log("");
    console.log(`📍 Location: ${gpsData.zone?.display_name || "Unknown"}`);
    console.log(`   ${gpsData.latitude}, ${gpsData.longitude}`);
    console.log(`   Census: ${tract.countyName}, Tract ${tract.tract}`);
    console.log("");
    console.log(`⏰ Time: ${new Date(gpsData.recorded_at).toLocaleString()}`);
    console.log("");
    console.log(`🎯 Estimated Audience Demographics:`);
    console.log(
      `   Median Income: $${weighted.median_income.toLocaleString()}`
    );
    console.log(`   Median Age: ${weighted.median_age} years`);
    console.log(`   Education: ${weighted.bachelors_pct}% Bachelor's+`);
    console.log(
      `   Primary Age Group: ${weighted.primary_age_group} (${
        weighted.age_distribution[weighted.primary_age_group]
      }%)`
    );
    console.log("");
    console.log(`📈 Age Distribution:`);
    Object.entries(weighted.age_distribution).forEach(([range, pct]) => {
      const bar = "█".repeat(Math.round(parseFloat(pct) / 2));
      console.log(`   ${range.padEnd(8)}: ${bar} ${pct}%`);
    });
    console.log("");
    console.log(`🎭 Audience Composition:`);
    console.log(
      `   Residents: ${(weighted.weights.residential * 100).toFixed(0)}%`
    );
    console.log(
      `   Workers: ${(weighted.weights.workforce * 100).toFixed(0)}%`
    );
    console.log(
      `   Tourists/Visitors: ${(weighted.weights.tourist * 100).toFixed(0)}%`
    );
    console.log("");
    console.log(
      `💡 Confidence Level: ${zoneClass.poi_count > 0 ? "High" : "Medium"}`
    );
    console.log(
      `   (Based on ${
        zoneClass.poi_count > 0 ? "OSM POI data + Census" : "Census data only"
      })`
    );
    console.log("");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log("   ✅ TEST COMPLETE");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log("");

    // Return structured data for potential API integration
    return {
      location: {
        latitude: gpsData.latitude,
        longitude: gpsData.longitude,
        zone: gpsData.zone?.display_name,
        zone_type: zoneClass.type,
        census_tract: tract.tract,
        county: tract.countyName,
      },
      timestamp: gpsData.recorded_at,
      demographics: weighted,
      source_data: {
        residential,
        workforce,
        tourist: TOURIST_PROFILE,
      },
    };
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { main };
