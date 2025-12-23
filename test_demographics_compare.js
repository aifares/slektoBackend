#!/usr/bin/env node

/**
 * Demographics Comparison Script
 * 
 * Compares demographics across multiple zones
 */

const { main } = require("./test_demographics");
const fs = require("fs");

async function compareZones(zoneIds) {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   🔄 MULTI-ZONE DEMOGRAPHIC COMPARISON");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log(`   Comparing ${zoneIds.length} zones...\n`);

  const results = [];

  // Run demographics for each zone
  for (const zoneId of zoneIds) {
    try {
      console.log(`\n🔍 Processing Zone ID: ${zoneId}`);
      console.log("─".repeat(65));
      const result = await main(zoneId);
      results.push(result);
      console.log(`✅ Zone ${zoneId} complete\n`);
    } catch (error) {
      console.error(`❌ Failed to process zone ${zoneId}:`, error.message);
    }
  }

  // Generate comparison
  const comparison = generateComparison(results);

  // Save comparison
  const outputPath = "./demographics_comparison_auto.json";
  fs.writeFileSync(outputPath, JSON.stringify(comparison, null, 2));

  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   📊 COMPARISON SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  // Display summary table
  console.log("Zone Comparison:");
  console.log("─".repeat(100));
  console.log(
    "Zone".padEnd(25) +
      "Income".padEnd(15) +
      "Age".padEnd(10) +
      "Education".padEnd(15) +
      "Type"
  );
  console.log("─".repeat(100));

  for (const zone of comparison.zones) {
    console.log(
      zone.zone_name.padEnd(25) +
        `$${zone.demographics.median_income.toLocaleString()}`.padEnd(15) +
        `${zone.demographics.median_age}y`.padEnd(10) +
        `${zone.demographics.bachelors_degree_pct}%`.padEnd(15) +
        zone.zone_type
    );
  }

  console.log("─".repeat(100));
  console.log("");

  // Show key insights
  if (comparison.insights) {
    console.log("💡 Key Insights:");
    console.log("");
    comparison.insights.forEach((insight, i) => {
      console.log(`   ${i + 1}. ${insight}`);
    });
    console.log("");
  }

  console.log(`📄 Full comparison saved to: ${outputPath}`);
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  return comparison;
}

function generateComparison(results) {
  const zones = results.map((r) => ({
    zone_name: r.location.zone,
    borough: r.location.county.replace(" County", ""),
    zone_type: r.location.zone_type,
    demographics: {
      median_income: r.demographics.median_income,
      median_age: r.demographics.median_age,
      bachelors_degree_pct: r.demographics.bachelors_degree_pct,
      primary_age_group: r.demographics.primary_age_group,
      total_population:
        r.source_data.residential.total_population,
    },
    audience_composition: r.demographics.audience_composition,
    timestamp: r.timestamp,
  }));

  // Calculate insights
  const insights = [];

  // Income comparison
  const incomes = zones.map((z) => z.demographics.median_income);
  const maxIncome = Math.max(...incomes);
  const minIncome = Math.min(...incomes);
  const richestZone = zones.find((z) => z.demographics.median_income === maxIncome);
  const poorestZone = zones.find((z) => z.demographics.median_income === minIncome);

  if (richestZone && poorestZone && richestZone !== poorestZone) {
    const incomeGap = ((maxIncome / minIncome - 1) * 100).toFixed(0);
    insights.push(
      `${richestZone.zone_name} has ${incomeGap}% higher income than ${poorestZone.zone_name} ($${maxIncome.toLocaleString()} vs $${minIncome.toLocaleString()})`
    );
  }

  // Education comparison
  const educations = zones.map((z) => z.demographics.bachelors_degree_pct);
  const maxEdu = Math.max(...educations);
  const minEdu = Math.min(...educations);
  const mostEducated = zones.find((z) => z.demographics.bachelors_degree_pct === maxEdu);
  const leastEducated = zones.find((z) => z.demographics.bachelors_degree_pct === minEdu);

  if (mostEducated && leastEducated && mostEducated !== leastEducated) {
    insights.push(
      `${mostEducated.zone_name} is most educated (${maxEdu}% Bachelor's+), ${leastEducated.zone_name} is least (${minEdu}%)`
    );
  }

  // Age comparison
  const ageGroups = zones.map((z) => ({
    zone: z.zone_name,
    primary: z.demographics.primary_age_group,
  }));
  const youngestGroup = ageGroups.reduce((prev, curr) => {
    const prevStart = parseInt(prev.primary.split("-")[0]);
    const currStart = parseInt(curr.primary.split("-")[0]);
    return currStart < prevStart ? curr : prev;
  });
  const oldestGroup = ageGroups.reduce((prev, curr) => {
    const prevStart = parseInt(prev.primary.split("-")[0]);
    const currStart = parseInt(curr.primary.split("-")[0]);
    return currStart > prevStart ? curr : prev;
  });

  if (youngestGroup.zone !== oldestGroup.zone) {
    insights.push(
      `${youngestGroup.zone} skews younger (${youngestGroup.primary}), ${oldestGroup.zone} skews older (${oldestGroup.primary})`
    );
  }

  // Audience composition insights
  zones.forEach((zone) => {
    const comp = zone.audience_composition;
    if (comp.residents_pct >= 70) {
      insights.push(
        `${zone.zone_name} is primarily residential (${comp.residents_pct}% residents)`
      );
    } else if (comp.workers_pct >= 60) {
      insights.push(
        `${zone.zone_name} is business-focused (${comp.workers_pct}% workers)`
      );
    } else if (comp.tourists_visitors_pct >= 50) {
      insights.push(
        `${zone.zone_name} is tourist-heavy (${comp.tourists_visitors_pct}% visitors)`
      );
    }
  });

  // Generate advertising recommendations
  const advertising_recommendations = {};
  zones.forEach((zone) => {
    const recs = [];
    
    // Income-based
    if (zone.demographics.median_income > 150000) {
      recs.push("Luxury brands and premium products");
      recs.push("High-end real estate");
      recs.push("Financial services and investments");
    } else if (zone.demographics.median_income > 100000) {
      recs.push("Premium consumer goods");
      recs.push("Professional services");
      recs.push("Upscale dining and entertainment");
    } else {
      recs.push("Value-oriented products");
      recs.push("Family services and education");
      recs.push("Local businesses and retail");
    }

    // Age-based
    const primaryAgeStart = parseInt(zone.demographics.primary_age_group.split("-")[0]);
    if (primaryAgeStart < 35) {
      recs.push("Tech products and apps");
      recs.push("Fitness and wellness");
    } else if (primaryAgeStart >= 55) {
      recs.push("Healthcare and insurance");
      recs.push("Travel and leisure");
    } else {
      recs.push("Family-oriented products");
      recs.push("Home improvement");
    }

    // Audience composition
    if (zone.audience_composition.workers_pct >= 50) {
      recs.push("B2B services");
      recs.push("Quick service restaurants");
    }
    if (zone.audience_composition.tourists_visitors_pct >= 30) {
      recs.push("Hospitality and tourism");
      recs.push("Entertainment venues");
    }

    advertising_recommendations[zone.zone_name] = [...new Set(recs)];
  });

  return {
    comparison_date: new Date().toISOString().split("T")[0],
    generated_at: new Date().toISOString(),
    zones_compared: zones.length,
    zones: zones,
    insights: insights,
    advertising_recommendations: advertising_recommendations,
    summary_statistics: {
      income_range: {
        min: minIncome,
        max: maxIncome,
        average: Math.round(
          incomes.reduce((a, b) => a + b, 0) / incomes.length
        ),
      },
      education_range: {
        min: minEdu,
        max: maxEdu,
        average: (educations.reduce((a, b) => a + b, 0) / educations.length).toFixed(1),
      },
    },
  };
}

// Run if called directly
if (require.main === module) {
  // Accept multiple zone IDs as arguments: node test_demographics_compare.js 191 466
  const zoneIds = process.argv.slice(2).map((id) => parseInt(id));

  if (zoneIds.length < 2) {
    console.error("\n❌ Error: Please provide at least 2 zone IDs to compare");
    console.log("\nUsage: node test_demographics_compare.js [zoneId1] [zoneId2] [zoneId3] ...");
    console.log("Example: node test_demographics_compare.js 191 466\n");
    process.exit(1);
  }

  compareZones(zoneIds)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n❌ Comparison failed:", err.message);
      console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { compareZones };




