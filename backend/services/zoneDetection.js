const { supabase } = require("../config/supabase");

// Cache for zones to avoid repeated DB queries
let zonesCache = null;
let cacheLoadedAt = null;
const CACHE_TTL = 3600000; // 1 hour in milliseconds

/**
 * Load all zones from database into memory cache
 */
async function loadZonesCache() {
  try {
    const { data: zones, error } = await supabase
      .from("nyc_zones")
      .select("*")
      .order("density_multiplier", { ascending: false }); // Higher density zones first for priority

    if (error) {
      throw new Error(`Failed to load zones: ${error.message}`);
    }

    zonesCache = zones || [];
    cacheLoadedAt = Date.now();

    console.log(`✅ Loaded ${zonesCache.length} zones into cache`);
    return zonesCache;
  } catch (error) {
    console.error("❌ Error loading zones cache:", error.message);
    throw error;
  }
}

/**
 * Get zones from cache or load if needed
 */
async function getZones() {
  // Check if cache needs refresh
  if (!zonesCache || !cacheLoadedAt || Date.now() - cacheLoadedAt > CACHE_TTL) {
    await loadZonesCache();
  }
  return zonesCache;
}

/**
 * Detect which zone a GPS coordinate belongs to
 * @param {number} latitude - GPS latitude
 * @param {number} longitude - GPS longitude
 * @returns {object|null} Zone object with id and details, or null if not in any zone
 */
async function detectZone(latitude, longitude) {
  try {
    const zones = await getZones();

    // Find the first zone that contains this coordinate
    // Zones are sorted by density_multiplier desc, so we get high-traffic zones first
    for (const zone of zones) {
      if (
        latitude >= zone.min_latitude &&
        latitude <= zone.max_latitude &&
        longitude >= zone.min_longitude &&
        longitude <= zone.max_longitude
      ) {
        return zone;
      }
    }

    // Not in any defined zone
    return null;
  } catch (error) {
    console.error("❌ Error detecting zone:", error.message);
    return null;
  }
}

/**
 * Detect zone for multiple GPS points efficiently
 * @param {Array} gpsPoints - Array of {latitude, longitude} objects
 * @returns {Array} Array of {latitude, longitude, zone} objects
 */
async function detectZonesForPoints(gpsPoints) {
  try {
    const zones = await getZones();

    return gpsPoints.map((point) => {
      let detectedZone = null;

      // Find zone for this point
      for (const zone of zones) {
        if (
          point.latitude >= zone.min_latitude &&
          point.latitude <= zone.max_latitude &&
          point.longitude >= zone.min_longitude &&
          point.longitude <= zone.max_longitude
        ) {
          detectedZone = zone;
          break;
        }
      }

      return {
        ...point,
        zone: detectedZone,
        zone_id: detectedZone ? detectedZone.id : null,
      };
    });
  } catch (error) {
    console.error("❌ Error detecting zones for points:", error.message);
    // Return points without zone info on error
    return gpsPoints.map((point) => ({
      ...point,
      zone: null,
      zone_id: null,
    }));
  }
}

/**
 * Get zone by ID
 */
async function getZoneById(zoneId) {
  try {
    const zones = await getZones();
    return zones.find((z) => z.id === zoneId) || null;
  } catch (error) {
    console.error("❌ Error getting zone by ID:", error.message);
    return null;
  }
}

/**
 * Get all zones with optional filtering
 */
async function getAllZones(filterOptions = {}) {
  try {
    const zones = await getZones();

    let filteredZones = [...zones];

    // Apply filters if provided
    if (filterOptions.zone_type) {
      filteredZones = filteredZones.filter(
        (z) => z.zone_type === filterOptions.zone_type
      );
    }

    if (filterOptions.minDensity) {
      filteredZones = filteredZones.filter(
        (z) => z.density_multiplier >= filterOptions.minDensity
      );
    }

    return filteredZones;
  } catch (error) {
    console.error("❌ Error getting all zones:", error.message);
    return [];
  }
}

/**
 * Force reload of zones cache
 */
async function refreshZonesCache() {
  zonesCache = null;
  cacheLoadedAt = null;
  return await loadZonesCache();
}

module.exports = {
  detectZone,
  detectZonesForPoints,
  getZoneById,
  getAllZones,
  loadZonesCache,
  refreshZonesCache,
};
