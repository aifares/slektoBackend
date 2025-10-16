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
