const { supabase } = require("../config/supabase");
const { detectZone } = require("../services/zoneDetection");

const BATCH_SIZE = 100; // Process 100 points at a time

async function backfillZones() {
  console.log("\n🔄 Starting zone backfill process...\n");

  // Get total count of GPS points without zone_id
  const { count: totalNull, error: countError } = await supabase
    .from("terminal_gps_data")
    .select("*", { count: "exact", head: true })
    .is("zone_id", null);

  if (countError) {
    console.error("❌ Error counting GPS points:", countError);
    return;
  }

  console.log(`📊 Found ${totalNull} GPS points without zone_id\n`);

  if (totalNull === 0) {
    console.log("✅ All GPS points already have zone_id. Nothing to backfill!");
    return;
  }

  let processed = 0;
  let updated = 0;
  let notInZone = 0;
  let errors = 0;

  // Process in batches
  while (processed < totalNull) {
    try {
      // Fetch batch of GPS points without zone_id
      const { data: gpsPoints, error: fetchError } = await supabase
        .from("terminal_gps_data")
        .select("id, latitude, longitude, terminal_id")
        .is("zone_id", null)
        .limit(BATCH_SIZE);

      if (fetchError) {
        console.error("❌ Error fetching batch:", fetchError);
        break;
      }

      if (!gpsPoints || gpsPoints.length === 0) {
        break; // No more points to process
      }

      console.log(
        `\n🔍 Processing batch: ${processed + 1} to ${
          processed + gpsPoints.length
        } of ${totalNull}`
      );

      // Process each point in the batch
      for (const point of gpsPoints) {
        try {
          // Detect zone for this GPS point
          const zone = await detectZone(point.latitude, point.longitude);

          if (zone) {
            // Update the GPS point with zone_id
            const { error: updateError } = await supabase
              .from("terminal_gps_data")
              .update({ zone_id: zone.id })
              .eq("id", point.id);

            if (updateError) {
              console.error(
                `❌ Error updating point ${point.id}:`,
                updateError.message
              );
              errors++;
            } else {
              updated++;
            }
          } else {
            // Point is not in any zone
            notInZone++;
          }

          processed++;

          // Progress indicator every 50 points
          if (processed % 50 === 0) {
            const percentage = ((processed / totalNull) * 100).toFixed(1);
            console.log(
              `   Progress: ${processed}/${totalNull} (${percentage}%) - Updated: ${updated}, Not in zone: ${notInZone}, Errors: ${errors}`
            );
          }
        } catch (pointError) {
          console.error(
            `❌ Error processing point ${point.id}:`,
            pointError.message
          );
          errors++;
          processed++;
        }
      }

      // Small delay between batches to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (batchError) {
      console.error("❌ Error processing batch:", batchError.message);
      errors++;
      break;
    }
  }

  // Final summary
  console.log("\n" + "=".repeat(60));
  console.log("🏁 Zone Backfill Complete!");
  console.log("=".repeat(60));
  console.log(`📊 Total processed: ${processed}`);
  console.log(`✅ Successfully updated: ${updated}`);
  console.log(`🗺️  Not in any zone: ${notInZone}`);
  console.log(`❌ Errors: ${errors}`);
  console.log("=".repeat(60));

  // Verify final stats
  const { count: remainingNull } = await supabase
    .from("terminal_gps_data")
    .select("*", { count: "exact", head: true })
    .is("zone_id", null);

  const { count: withZone } = await supabase
    .from("terminal_gps_data")
    .select("*", { count: "exact", head: true })
    .not("zone_id", "is", null);

  console.log(`\n📈 Final Statistics:`);
  console.log(`   GPS points WITH zone_id: ${withZone || 0}`);
  console.log(`   GPS points WITHOUT zone_id: ${remainingNull || 0}`);
  console.log("");
}

// Run the backfill
backfillZones()
  .then(() => {
    console.log("✅ Backfill script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error.message);
    process.exit(1);
  });
