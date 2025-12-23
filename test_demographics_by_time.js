#!/usr/bin/env node

/**
 * Demographics By Time Script
 *
 * Shows how demographics change throughout the day in the same zone
 */

const { supabase } = require("./backend/config/supabase");
const fs = require("fs");
const {
  getTouristProfile,
  calculateTimeWeights,
} = require("./backend/services/demographics");

// Import helper functions from main script
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
  };
}

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
    median_income: parseInt(result[CENSUS_VARS.MEDIAN_INCOME]) || 0,
    median_age: parseFloat(result[CENSUS_VARS.MEDIAN_AGE]) || 0,
    bachelors_pct: parseFloat(result[CENSUS_VARS.BACHELORS_PCT]) || 0,
    total_population: parseInt(result[CENSUS_VARS.TOTAL_POP]) || 0,
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

function calculateWeightedDemographics(
  residential,
  workforce,
  tourist,
  hour,
  dayOfWeek,
  zoneType
) {
  // Use the demographics service for time-based weights
  const { weights, reasoning } = calculateTimeWeights(
    zoneType,
    hour,
    dayOfWeek
  );

  const weighted = {
    median_income: Math.round(
      residential.median_income * weights.residential +
        workforce.median_income * weights.workforce +
        tourist.median_income * weights.tourist
    ),
    median_age: parseFloat(
      (
        residential.median_age * weights.residential +
        workforce.median_age * weights.workforce +
        tourist.median_age * weights.tourist
      ).toFixed(1)
    ),
    bachelors_pct: parseFloat(
      (
        residential.bachelors_pct * weights.residential +
        workforce.bachelors_pct * weights.workforce +
        tourist.bachelors_pct * weights.tourist
      ).toFixed(1)
    ),
    weights: weights,
    reasoning: reasoning,
  };

  return weighted;
}

async function analyzeByTime(zoneId, timeSlots) {
  console.log("\n");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("   ⏰ DEMOGRAPHICS BY TIME OF DAY");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("");

  // Get zone info and GPS location
  const { data: zone } = await supabase
    .from("nyc_zones")
    .select("id, name, display_name, zone_type")
    .eq("id", zoneId)
    .single();

  if (!zone) {
    throw new Error(`Zone ${zoneId} not found`);
  }

  const { data: gpsData } = await supabase
    .from("terminal_gps_data")
    .select("latitude, longitude")
    .eq("zone_id", zoneId)
    .limit(1)
    .single();

  if (!gpsData) {
    throw new Error(`No GPS data for zone ${zoneId}`);
  }

  console.log(`📍 Zone: ${zone.display_name} (${zone.zone_type})`);
  console.log(`   Location: ${gpsData.latitude}, ${gpsData.longitude}`);
  console.log("");

  // Get census data once (doesn't change by time)
  console.log("🏘️  Fetching base demographics...\n");
  const tract = await getCensusTract(gpsData.latitude, gpsData.longitude);
  const residential = await getResidentialDemographics(
    tract.state,
    tract.county,
    tract.tract
  );

  // Simulate workforce (in real version, this would come from LODES)
  const workforce = {
    median_income: Math.floor(residential.median_income * 1.35),
    median_age: residential.median_age - 2,
    bachelors_pct: Math.min(85, residential.bachelors_pct * 1.2),
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

  // Get zone-specific tourist profile
  const touristProfile = getTouristProfile(zone.name, zone.zone_type);

  console.log("✅ Base demographics loaded\n");
  console.log(`👥 Visitor Profile: ${touristProfile.description}`);
  console.log(`   Type: ${touristProfile.profile_type}`);
  console.log(`   Income: $${touristProfile.median_income.toLocaleString()}`);
  console.log(`   Age: ${touristProfile.median_age} years`);
  console.log(`   Matched by: ${touristProfile.matched_by}`);
  console.log("");
  console.log("─".repeat(65));
  console.log("");

  const results = [];

  // Analyze each time slot
  for (const slot of timeSlots) {
    const { hour, day, label } = slot;
    const dayOfWeek = day || 3; // Default to Wednesday

    console.log(
      `⏰ ${label} (${hour}:00, ${
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek]
      })`
    );

    const weighted = calculateWeightedDemographics(
      residential,
      workforce,
      touristProfile,
      hour,
      dayOfWeek,
      zone.zone_type
    );

    console.log(
      `   Audience Mix: ${(weighted.weights.residential * 100).toFixed(
        0
      )}% residents, ${(weighted.weights.workforce * 100).toFixed(
        0
      )}% workers, ${(weighted.weights.tourist * 100).toFixed(0)}% visitors`
    );
    console.log(`   Income: $${weighted.median_income.toLocaleString()}`);
    console.log(`   Age: ${weighted.median_age} years`);
    console.log(`   Education: ${weighted.bachelors_pct}% Bachelor's+`);
    console.log(`   Rule: ${weighted.reasoning}`);
    console.log("");

    results.push({
      time_label: label,
      hour: hour,
      day_of_week: dayOfWeek,
      demographics: weighted,
    });
  }

  // Generate comparison
  const comparison = {
    zone: {
      id: zone.id,
      name: zone.display_name,
      type: zone.zone_type,
    },
    location: {
      latitude: gpsData.latitude,
      longitude: gpsData.longitude,
    },
    base_demographics: {
      residential: residential,
      workforce: workforce,
      tourist: {
        median_income: touristProfile.median_income,
        median_age: touristProfile.median_age,
        bachelors_pct: touristProfile.bachelors_pct,
        age_distribution: touristProfile.age_distribution,
        profile_type: touristProfile.profile_type,
        description: touristProfile.description,
        matched_by: touristProfile.matched_by,
      },
    },
    time_analysis: results,
    key_insights: generateTimeInsights(results, zone),
    generated_at: new Date().toISOString(),
  };

  // Save to file
  const outputPath = `./demographics_by_time_${zone.name}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(comparison, null, 2));

  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("   📊 TIME-BASED INSIGHTS");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("");

  comparison.key_insights.forEach((insight) => {
    console.log(`   • ${insight}`);
  });

  console.log("");
  console.log(`📄 Full analysis saved to: ${outputPath}`);
  console.log("");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("");

  return comparison;
}

function generateTimeInsights(results, zone) {
  const insights = [];

  // Find highest and lowest income times
  const incomes = results.map((r) => ({
    label: r.time_label,
    income: r.demographics.median_income,
  }));
  const maxIncome = Math.max(...incomes.map((i) => i.income));
  const minIncome = Math.min(...incomes.map((i) => i.income));
  const richestTime = incomes.find((i) => i.income === maxIncome);
  const poorestTime = incomes.find((i) => i.income === minIncome);

  if (maxIncome !== minIncome) {
    const diff = ((maxIncome / minIncome - 1) * 100).toFixed(0);
    insights.push(
      `Income varies by ${diff}% throughout the day: ${
        richestTime.label
      } ($${maxIncome.toLocaleString()}) vs ${
        poorestTime.label
      } ($${minIncome.toLocaleString()})`
    );
  }

  // Find peak worker times
  const peakWorkers = results.reduce((max, r) =>
    r.demographics.weights.workforce > max.demographics.weights.workforce
      ? r
      : max
  );
  if (peakWorkers.demographics.weights.workforce >= 0.5) {
    insights.push(
      `${peakWorkers.time_label} has highest worker presence (${(
        peakWorkers.demographics.weights.workforce * 100
      ).toFixed(0)}%) - ideal for B2B advertising`
    );
  }

  // Find peak tourist times
  const peakTourists = results.reduce((max, r) =>
    r.demographics.weights.tourist > max.demographics.weights.tourist ? r : max
  );
  if (peakTourists.demographics.weights.tourist >= 0.5) {
    insights.push(
      `${peakTourists.time_label} has highest tourist/visitor presence (${(
        peakTourists.demographics.weights.tourist * 100
      ).toFixed(0)}%) - ideal for consumer brands`
    );
  }

  // Find peak resident times
  const peakResidents = results.reduce((max, r) =>
    r.demographics.weights.residential > max.demographics.weights.residential
      ? r
      : max
  );
  if (peakResidents.demographics.weights.residential >= 0.6) {
    insights.push(
      `${peakResidents.time_label} is dominated by local residents (${(
        peakResidents.demographics.weights.residential * 100
      ).toFixed(0)}%) - ideal for local services`
    );
  }

  // Zone-specific insights
  if (zone.zone_type === "business") {
    insights.push(
      "As a business district, demographics shift dramatically between weekday business hours and evenings/weekends"
    );
  } else if (zone.zone_type === "tourist") {
    insights.push(
      "As a tourist area, expect higher visitor traffic during daytime, especially weekends"
    );
  } else if (zone.zone_type === "residential") {
    insights.push(
      "As a residential zone, local residents dominate except during weekday business hours"
    );
  }

  return insights;
}

// Run if called directly
if (require.main === module) {
  // Usage: node test_demographics_by_time.js [zoneId]
  const zoneId = parseInt(process.argv[2]);

  if (!zoneId) {
    console.error("\n❌ Error: Please provide a zone ID");
    console.log("\nUsage: node test_demographics_by_time.js [zoneId]");
    console.log("Example: node test_demographics_by_time.js 466\n");
    process.exit(1);
  }

  // Define time slots to analyze
  const timeSlots = [
    { hour: 8, day: 1, label: "Monday 8am (Morning Commute)" },
    { hour: 13, day: 3, label: "Wednesday 1pm (Lunch Hour)" },
    { hour: 18, day: 5, label: "Friday 6pm (Evening Rush)" },
    { hour: 22, day: 6, label: "Saturday 10pm (Night Out)" },
    { hour: 2, day: 0, label: "Sunday 2am (Late Night)" },
  ];

  analyzeByTime(zoneId, timeSlots)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n❌ Analysis failed:", err.message);
      console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { analyzeByTime };
