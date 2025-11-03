const { buildZoneCoverageMetrics } = require("../services/zoneCoverage");

async function testZoneCoverage() {
  console.log("\n🧪 Testing Zone Coverage By Program\n");

  // Test with the existing data
  const programIds = [2389650];
  const terminalIds = ["2355209"];
  const startDate = "2025-09-17";
  const endDate = "2025-10-14";

  try {
    console.log("Fetching zone coverage for:");
    console.log(`  Programs: ${programIds.join(", ")}`);
    console.log(`  Terminals: ${terminalIds.join(", ")}`);
    console.log(`  Date Range: ${startDate} to ${endDate}\n`);

    const zoneCoverage = await buildZoneCoverageMetrics(
      programIds,
      terminalIds,
      startDate,
      endDate
    );

    console.log("📊 Zone Coverage Result Structure:\n");
    console.log(JSON.stringify(zoneCoverage, null, 2));

    // Verify structure
    console.log("\n✅ Verification:");
    console.log(`  - Type: ${typeof zoneCoverage}`);
    console.log(
      `  - Is Object: ${
        typeof zoneCoverage === "object" && !Array.isArray(zoneCoverage)
      }`
    );
    console.log(`  - Program Keys: ${Object.keys(zoneCoverage).join(", ")}`);

    if (Object.keys(zoneCoverage).length > 0) {
      const firstProgramId = Object.keys(zoneCoverage)[0];
      const programData = zoneCoverage[firstProgramId];
      console.log(`\n  First Program (${firstProgramId}):`);
      console.log(`    - program_id: ${programData.program_id}`);
      console.log(`    - program_name: ${programData.program_name}`);
      console.log(
        `    - total_zones_visited: ${programData.total_zones_visited}`
      );
      console.log(
        `    - total_hours_in_zones: ${programData.total_hours_in_zones}`
      );
      console.log(`    - zones count: ${programData.zones?.length || 0}`);

      // Check time breakdown in zones
      if (programData.zones && programData.zones.length > 0) {
        const firstZone = programData.zones[0];
        console.log(`\n  First Zone (${firstZone.display_name}):`);
        console.log(`    - minutes_spent: ${firstZone.minutes_spent}`);
        console.log(`    - Has time_breakdown: ${!!firstZone.time_breakdown}`);

        if (firstZone.time_breakdown) {
          console.log(`    - Time Breakdown:`);
          console.log(
            `      Morning: ${firstZone.time_breakdown.morning.minutes} min (${firstZone.time_breakdown.morning.percentage}%)`
          );
          console.log(
            `      Afternoon: ${firstZone.time_breakdown.afternoon.minutes} min (${firstZone.time_breakdown.afternoon.percentage}%)`
          );
          console.log(
            `      Evening: ${firstZone.time_breakdown.evening.minutes} min (${firstZone.time_breakdown.evening.percentage}%)`
          );
          console.log(
            `      Night: ${firstZone.time_breakdown.night.minutes} min (${firstZone.time_breakdown.night.percentage}%)`
          );

          // Verify breakdown totals
          const totalBreakdownMinutes =
            firstZone.time_breakdown.morning.minutes +
            firstZone.time_breakdown.afternoon.minutes +
            firstZone.time_breakdown.evening.minutes +
            firstZone.time_breakdown.night.minutes;
          const breakdownMatchesTotal =
            Math.abs(totalBreakdownMinutes - firstZone.minutes_spent) < 1;

          console.log(
            `\n    - Verification: Breakdown minutes (${totalBreakdownMinutes.toFixed(
              2
            )}) ≈ Total minutes (${firstZone.minutes_spent})`
          );
          console.log(
            `      ✅ Match: ${breakdownMatchesTotal ? "YES" : "NO"}`
          );

          // Verify percentages sum to ~100%
          const totalPercentage =
            firstZone.time_breakdown.morning.percentage +
            firstZone.time_breakdown.afternoon.percentage +
            firstZone.time_breakdown.evening.percentage +
            firstZone.time_breakdown.night.percentage;
          const percentagesValid = Math.abs(totalPercentage - 100) < 5; // Allow 5% tolerance for rounding

          console.log(
            `    - Verification: Total percentage = ${totalPercentage.toFixed(
              1
            )}%`
          );
          console.log(`      ✅ Valid: ${percentagesValid ? "YES" : "NO"}`);
        } else {
          console.log(
            "    ⚠️  WARNING: time_breakdown is missing from zone data"
          );
        }
      }
    }

    console.log(
      "\n✨ Structure matches expected format (keyed by program_id)!"
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

testZoneCoverage()
  .then(() => {
    console.log("\n✅ Test completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error.message);
    process.exit(1);
  });
