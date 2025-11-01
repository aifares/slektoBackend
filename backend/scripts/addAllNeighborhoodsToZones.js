const fs = require("fs");
const path = require("path");
const { supabase } = require("../config/supabase");

/**
 * Calculate bounding box from polygon coordinates
 */
function calculateBoundingBox(coordinates) {
  if (!coordinates || !Array.isArray(coordinates[0])) {
    return null;
  }

  // Flatten all coordinate points (handle MultiPolygon if needed)
  const allPoints = [];
  if (Array.isArray(coordinates[0][0][0])) {
    // MultiPolygon or Polygon with holes
    for (const ring of coordinates[0]) {
      allPoints.push(...ring);
    }
  } else {
    // Simple polygon ring
    allPoints.push(...coordinates[0]);
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const [lon, lat] of allPoints) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }

  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Infer zone_type from neighborhood name or borough
 */
function inferZoneType(neighborhoodName, borough) {
  const name = neighborhoodName.toLowerCase();
  
  // Tourist areas
  if (
    name.includes("times square") ||
    name.includes("theater district") ||
    name.includes("empire state") ||
    name.includes("statue of liberty") ||
    name.includes("central park") ||
    name.includes("dumbo") ||
    name.includes("brooklyn bridge") ||
    name.includes("high line")
  ) {
    return "tourist";
  }

  // Shopping areas
  if (
    name.includes("soho") ||
    name.includes("noho") ||
    name.includes("meatpacking") ||
    name.includes("chelsea market") ||
    name.includes("williamsburg")
  ) {
    return "shopping";
  }

  // Residential areas (usually outer boroughs or residential neighborhoods)
  if (
    name.includes("park") ||
    name.includes("heights") ||
    name.includes("village") ||
    name.includes("hills") ||
    name.includes("bay") ||
    borough?.toLowerCase().includes("staten island") ||
    borough?.toLowerCase().includes("bronx")
  ) {
    return "residential";
  }

  // Default to mixed
  return "mixed";
}

/**
 * Calculate density multiplier based on zone_type and location
 */
function calculateDensityMultiplier(zoneType, borough) {
  // Base multipliers by zone type
  const baseMultipliers = {
    tourist: 5.0,
    shopping: 3.0,
    mixed: 2.0,
    residential: 1.0,
  };

  let multiplier = baseMultipliers[zoneType] || 2.0;

  // Adjust based on borough (Manhattan generally higher density)
  if (borough?.toLowerCase() === "manhattan") {
    multiplier *= 1.5;
  } else if (
    borough?.toLowerCase() === "brooklyn" ||
    borough?.toLowerCase() === "queens"
  ) {
    multiplier *= 1.2;
  }

  // Cap at reasonable values
  return Math.min(multiplier, 10.0);
}

/**
 * Normalize neighborhood name for use as zone name (slug)
 */
function normalizeZoneName(neighborhoodName) {
  return neighborhoodName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Add all neighborhoods from GeoJSON to nyc_zones table
 */
async function addAllNeighborhoodsToZones() {
  try {
    console.log("🔄 Starting to add all neighborhoods from GeoJSON to zones...\n");

    // 1. Load GeoJSON file
    const geoJsonPath = path.join(__dirname, "../../geoJson.json");
    console.log(`📖 Loading GeoJSON from: ${geoJsonPath}`);

    if (!fs.existsSync(geoJsonPath)) {
      throw new Error(`GeoJSON file not found at: ${geoJsonPath}`);
    }

    const geoJsonContent = fs.readFileSync(geoJsonPath, "utf8");
    const geoJson = JSON.parse(geoJsonContent);

    if (!geoJson.features || !Array.isArray(geoJson.features)) {
      throw new Error("Invalid GeoJSON format: missing features array");
    }

    console.log(`✅ Loaded ${geoJson.features.length} neighborhoods from GeoJSON\n`);

    // 2. Fetch existing zones to check for duplicates
    console.log("📊 Fetching existing zones from database...");
    const { data: existingZones, error: zonesError } = await supabase
      .from("nyc_zones")
      .select("name");

    if (zonesError) {
      throw new Error(`Failed to fetch zones: ${zonesError.message}`);
    }

    const existingZoneNames = new Set(
      (existingZones || []).map((z) => z.name.toLowerCase())
    );
    console.log(`✅ Found ${existingZoneNames.size} existing zones\n`);

    // 3. Process neighborhoods
    const newZones = [];
    const skipped = [];
    const errors = [];
    const processedZoneNames = new Set(existingZoneNames); // Track zones we're adding in this run

    for (const feature of geoJson.features) {
      try {
        const neighborhoodName = feature.properties.neighborhood;
        const borough = feature.properties.borough;

        if (!neighborhoodName) {
          skipped.push({ reason: "No neighborhood name", feature });
          continue;
        }

        // Generate zone name (slug)
        let zoneName = normalizeZoneName(neighborhoodName);
        
        // Handle duplicates by appending borough or unique identifier
        let originalZoneName = zoneName;
        let counter = 1;
        while (processedZoneNames.has(zoneName)) {
          // Try appending borough abbreviation if available
          if (counter === 1 && borough) {
            const boroughAbbr = borough.substring(0, 3).toLowerCase();
            zoneName = `${originalZoneName}-${boroughAbbr}`;
          } else {
            // Or append a number
            zoneName = `${originalZoneName}-${counter}`;
          }
          counter++;
          // Safety check to prevent infinite loop
          if (counter > 10) break;
        }
        
        // Add to tracking set for current batch
        processedZoneNames.add(zoneName);

        // Extract geometry
        const geometry = feature.geometry;
        if (!geometry || geometry.type !== "Polygon" || !geometry.coordinates) {
          skipped.push({
            name: neighborhoodName,
            reason: "Invalid or missing geometry",
          });
          continue;
        }

        // Calculate bounding box
        const bbox = calculateBoundingBox(geometry.coordinates);
        if (!bbox) {
          skipped.push({
            name: neighborhoodName,
            reason: "Could not calculate bounding box",
          });
          continue;
        }

        // Infer zone type and density
        const zoneType = inferZoneType(neighborhoodName, borough);
        const densityMultiplier = calculateDensityMultiplier(zoneType, borough);

        // Prepare geometry JSONB
        const geometryJson = {
          type: geometry.type,
          coordinates: geometry.coordinates,
        };

        // Prepare zone entry
        const zoneEntry = {
          name: zoneName,
          display_name: neighborhoodName,
          zone_type: zoneType,
          min_latitude: bbox.minLat,
          max_latitude: bbox.maxLat,
          min_longitude: bbox.minLon,
          max_longitude: bbox.maxLon,
          density_multiplier: densityMultiplier,
          geometry: geometryJson,
        };

        newZones.push({
          entry: zoneEntry,
          neighborhood: neighborhoodName,
          borough: borough || "Unknown",
        });
      } catch (error) {
        errors.push({
          feature: feature.properties?.neighborhood || "Unknown",
          error: error.message,
        });
      }
    }

    console.log(`📈 Summary:`);
    console.log(`   ✅ New zones to add: ${newZones.length}`);
    console.log(`   ⏭️  Skipped: ${skipped.length}`);
    console.log(`   ❌ Errors: ${errors.length}\n`);

    if (errors.length > 0 && errors.length <= 10) {
      console.log("⚠️  Errors encountered:");
      errors.forEach((e) => {
        console.log(`   - ${e.feature}: ${e.error}`);
      });
      console.log();
    }

    // 4. Insert new zones in batches
    if (newZones.length === 0) {
      console.log("✅ No new zones to add. All neighborhoods already exist in database.");
      return;
    }

    console.log(`💾 Inserting ${newZones.length} new zones...`);

    let inserted = 0;
    let failed = 0;
    const BATCH_SIZE = 50;

    // Process in batches
    for (let i = 0; i < newZones.length; i += BATCH_SIZE) {
      const batch = newZones.slice(i, i + BATCH_SIZE);
      const batchEntries = batch.map((z) => z.entry);

      try {
        // Insert one by one to handle individual failures
        for (const entry of batchEntries) {
          try {
            const { data: insertedData, error: insertError } = await supabase
              .from("nyc_zones")
              .insert(entry)
              .select("name")
              .single();

            if (insertError) {
              // Check if it's a duplicate key error (zone might have been added between runs)
              if (insertError.message.includes("duplicate key") || insertError.message.includes("unique constraint")) {
                skipped.push({
                  name: entry.display_name,
                  reason: "Duplicate zone name (conflict)",
                });
              } else {
                console.error(
                  `❌ Error inserting zone ${entry.name}:`,
                  insertError.message
                );
                failed++;
              }
            } else {
              inserted++;
              if (inserted % 50 === 0) {
                console.log(`   Progress: ${inserted}/${newZones.length} zones inserted`);
              }
            }
          } catch (error) {
            console.error(
              `❌ Error inserting zone ${entry.name}:`,
              error.message
            );
            failed++;
          }
        }
      } catch (error) {
        console.error(
          `❌ Error processing batch ${Math.floor(i / BATCH_SIZE) + 1}:`,
          error.message
        );
      }

      // Small delay between batches
      if (i + BATCH_SIZE < newZones.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`\n🎉 Import complete!`);
    console.log(`   ✅ Successfully inserted: ${inserted}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏭️  Skipped: ${skipped.length}`);

    if (skipped.length > 0 && skipped.length <= 20) {
      console.log(`\n📋 Skipped neighborhoods (first 20):`);
      skipped.slice(0, 20).forEach((s) => {
        console.log(`   - ${s.name || "Unknown"}: ${s.reason}`);
      });
      if (skipped.length > 20) {
        console.log(`   ... and ${skipped.length - 20} more`);
      }
    }

    // 5. Show zone type distribution
    const zoneTypeCounts = {};
    newZones.forEach((z) => {
      zoneTypeCounts[z.entry.zone_type] =
        (zoneTypeCounts[z.entry.zone_type] || 0) + 1;
    });

    console.log(`\n📊 New zones by type:`);
    Object.entries(zoneTypeCounts).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  addAllNeighborhoodsToZones()
    .then(() => {
      console.log("\n✅ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error.message);
      process.exit(1);
    });
}

module.exports = { addAllNeighborhoodsToZones };

