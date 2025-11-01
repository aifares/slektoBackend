const fs = require("fs");
const path = require("path");
const { supabase } = require("../config/supabase");

/**
 * Normalize zone name for matching
 * - Convert to lowercase
 * - Replace hyphens/underscores with spaces
 * - Remove extra spaces
 */
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to match zone name to GeoJSON neighborhood name
 * Handles variations like "bedstuy" -> "Bedford-Stuyvesant"
 */
function findMatchingNeighborhood(zoneName, neighborhoods) {
  const normalizedZone = normalizeName(zoneName);

  // Direct match first
  for (const neighborhood of neighborhoods) {
    if (normalizeName(neighborhood.properties.neighborhood) === normalizedZone) {
      return neighborhood;
    }
  }

  // Partial match (e.g., "bedstuy" matches "Bedford-Stuyvesant")
  for (const neighborhood of neighborhoods) {
    const normalizedNeighborhood = normalizeName(
      neighborhood.properties.neighborhood
    );
    if (
      normalizedNeighborhood.includes(normalizedZone) ||
      normalizedZone.includes(normalizedNeighborhood) ||
      // Check if zone is an abbreviation (all words start with same letters)
      normalizedZone
        .split(" ")
        .every(
          (word, i) =>
            normalizedNeighborhood.split(" ")[i]?.startsWith(word[0])
        )
    ) {
      return neighborhood;
    }
  }

  // Special cases for known mismatches
  const specialMatches = {
    "times-square": "Theater District", // Times Square is in Theater District
    "lower-east-side": "Lower East Side",
    "upper-east-side": "Upper East Side",
    "upper-west-side": "Upper West Side",
    "west-village": "West Village",
    "east-village": "East Village",
    "lower-east-side": "Lower East Side",
    "downtown-brooklyn": "Downtown Brooklyn",
    "brooklyn-heights": "Brooklyn Heights",
    "crown-heights": "Crown Heights",
    "park-slope": "Park Slope",
    "prospect-heights": "Prospect Heights",
    "boerum-hill": "Boerum Hill",
    "fort-greene": "Fort Greene",
    bedstuy: "Bedford-Stuyvesant",
    soho: "SoHo", // Note: GeoJSON uses "SoHo" not "Soho"
    fidi: "Financial District",
    chinatown: "Chinatown",
    chelsea: "Chelsea",
    midtown: "Midtown",
    harlem: "Harlem",
    williamsburg: "Williamsburg",
    greenpoint: "Greenpoint",
    bushwick: "Bushwick",
    dumbo: "DUMBO",
    "sunset-park": "Sunset Park",
    "south-brooklyn": "South Brooklyn", // This might not match directly
  };

  // Check special matches - handle both "times square" and "times-square" formats
  const zoneKeyWithHyphen = normalizedZone.replace(/\s+/g, "-");
  const specialMatch = specialMatches[normalizedZone] || specialMatches[zoneKeyWithHyphen];
  
  if (specialMatch) {
    const normalizedSpecialMatch = normalizeName(specialMatch);
    for (const neighborhood of neighborhoods) {
      if (
        normalizeName(neighborhood.properties.neighborhood) === normalizedSpecialMatch
      ) {
        return neighborhood;
      }
    }
  }

  return null;
}

/**
 * Backfill zone geometries from GeoJSON file
 */
async function backfillZoneGeometries() {
  try {
    console.log("🔄 Starting zone geometry backfill...");

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

    console.log(`✅ Loaded ${geoJson.features.length} neighborhoods from GeoJSON`);

    // 2. Fetch all zones from database
    console.log("📊 Fetching zones from database...");
    const { data: zones, error: zonesError } = await supabase
      .from("nyc_zones")
      .select("id, name, display_name")
      .order("name");

    if (zonesError) {
      throw new Error(`Failed to fetch zones: ${zonesError.message}`);
    }

    console.log(`✅ Found ${zones.length} zones in database`);

    // 3. Match zones to neighborhoods and prepare updates
    const updates = [];
    const unmatched = [];
    const matched = [];

    for (const zone of zones) {
      const neighborhood = findMatchingNeighborhood(
        zone.display_name || zone.name,
        geoJson.features
      );

      if (!neighborhood) {
        unmatched.push({
          id: zone.id,
          name: zone.name,
          display_name: zone.display_name,
        });
        console.log(`⚠️  No match found for: ${zone.display_name || zone.name}`);
        continue;
      }

      // Extract geometry coordinates
      const geometry = neighborhood.geometry;
      if (!geometry || geometry.type !== "Polygon" || !geometry.coordinates) {
        console.warn(
          `⚠️  Invalid geometry for ${neighborhood.properties.neighborhood}: ${zone.display_name}`
        );
        unmatched.push(zone);
        continue;
      }

      // Store geometry as JSONB (coordinates array)
      const geometryJson = {
        type: geometry.type,
        coordinates: geometry.coordinates,
      };

      matched.push({
        zone: zone.name,
        neighborhood: neighborhood.properties.neighborhood,
      });

      updates.push({
        id: zone.id,
        geometry: geometryJson,
      });
    }

    console.log(`\n📈 Summary:`);
    console.log(`   ✅ Matched: ${matched.length}`);
    console.log(`   ⚠️  Unmatched: ${unmatched.length}`);

    if (matched.length > 0) {
      console.log("\n✅ Matched zones:");
      matched.forEach(({ zone, neighborhood }) => {
        console.log(`   - ${zone} → ${neighborhood}`);
      });
    }

    if (unmatched.length > 0) {
      console.log("\n⚠️  Unmatched zones (need manual review):");
      unmatched.forEach((zone) => {
        console.log(`   - ${zone.display_name || zone.name} (ID: ${zone.id})`);
      });
    }

    // 4. Update database in batches
    if (updates.length === 0) {
      console.log("\n❌ No updates to perform");
      return;
    }

    console.log(`\n💾 Updating ${updates.length} zones with geometry...`);

    let updated = 0;
    let errors = 0;

    // Process in batches of 10 to avoid overwhelming the database
    const BATCH_SIZE = 10;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      for (const update of batch) {
        try {
          const { error: updateError } = await supabase
            .from("nyc_zones")
            .update({ geometry: update.geometry })
            .eq("id", update.id);

          if (updateError) {
            console.error(
              `❌ Error updating zone ${update.id}:`,
              updateError.message
            );
            errors++;
          } else {
            updated++;
            if (updated % 10 === 0) {
              console.log(`   Progress: ${updated}/${updates.length}`);
            }
          }
        } catch (error) {
          console.error(`❌ Error updating zone ${update.id}:`, error.message);
          errors++;
        }
      }
    }

    console.log(`\n🎉 Backfill complete!`);
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   ⚠️  Unmatched: ${unmatched.length}`);

    if (unmatched.length > 0) {
      console.log(
        `\n💡 Tip: Review unmatched zones and manually match them in the database if needed.`
      );
    }
  } catch (error) {
    console.error("❌ Fatal error in backfill:", error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  backfillZoneGeometries()
    .then(() => {
      console.log("\n✅ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error.message);
      process.exit(1);
    });
}

module.exports = { backfillZoneGeometries };

