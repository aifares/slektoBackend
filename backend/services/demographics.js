/**
 * Demographics Service
 * 
 * Provides demographic profiling based on location, time, and zone type
 * with zone-specific tourist/visitor profiles
 */

/**
 * Zone-Specific Tourist/Visitor Profiles
 * 
 * Based on NYC tourism data and neighborhood characteristics
 */
const TOURIST_PROFILES = {
  // High-end shopping districts (SoHo, 5th Ave, Hudson Yards)
  shopping_luxury: {
    median_income: 125000,
    median_age: 35,
    bachelors_pct: 70,
    age_distribution: {
      "18-24": 15,
      "25-34": 40,
      "35-44": 30,
      "45-54": 10,
      "55-64": 4,
      "65+": 1,
    },
    profile_type: "luxury_shopper",
    description: "Affluent shoppers visiting high-end retail",
  },

  // Tourist attractions (Times Square, Empire State, Statue of Liberty)
  tourist_attraction: {
    median_income: 65000,
    median_age: 42,
    bachelors_pct: 45,
    age_distribution: {
      "18-24": 12,
      "25-34": 18,
      "35-44": 32,
      "45-54": 24,
      "55-64": 10,
      "65+": 4,
    },
    profile_type: "family_tourist",
    description: "Family tourists and sightseers",
  },

  // Business districts (FiDi, Midtown)
  business_visitor: {
    median_income: 135000,
    median_age: 38,
    bachelors_pct: 85,
    age_distribution: {
      "18-24": 5,
      "25-34": 35,
      "35-44": 40,
      "45-54": 15,
      "55-64": 4,
      "65+": 1,
    },
    profile_type: "business_traveler",
    description: "Business travelers and conference attendees",
  },

  // Entertainment/Nightlife (Meatpacking, East Village, Williamsburg)
  entertainment_visitor: {
    median_income: 85000,
    median_age: 29,
    bachelors_pct: 65,
    age_distribution: {
      "18-24": 30,
      "25-34": 50,
      "35-44": 15,
      "45-54": 4,
      "55-64": 1,
      "65+": 0,
    },
    profile_type: "nightlife_visitor",
    description: "Young adults visiting for nightlife and entertainment",
  },

  // Cultural districts (Museum Mile, Lincoln Center, Brooklyn Heights)
  cultural_visitor: {
    median_income: 95000,
    median_age: 45,
    bachelors_pct: 75,
    age_distribution: {
      "18-24": 8,
      "25-34": 20,
      "35-44": 25,
      "45-54": 25,
      "55-64": 15,
      "65+": 7,
    },
    profile_type: "cultural_visitor",
    description: "Visitors to museums, theaters, and cultural venues",
  },

  // Food/Restaurant districts (Chelsea Market, Little Italy, Chinatown)
  dining_visitor: {
    median_income: 80000,
    median_age: 33,
    bachelors_pct: 60,
    age_distribution: {
      "18-24": 18,
      "25-34": 40,
      "35-44": 25,
      "45-54": 12,
      "55-64": 4,
      "65+": 1,
    },
    profile_type: "foodie",
    description: "Food enthusiasts and restaurant-goers",
  },

  // Residential with local amenities (most residential neighborhoods)
  local_visitor: {
    median_income: 75000,
    median_age: 35,
    bachelors_pct: 55,
    age_distribution: {
      "18-24": 15,
      "25-34": 35,
      "35-44": 30,
      "45-54": 12,
      "55-64": 6,
      "65+": 2,
    },
    profile_type: "local_visitor",
    description: "People from nearby neighborhoods visiting local businesses",
  },

  // Mixed-use areas (Tribeca, West Village, Upper West Side)
  mixed_visitor: {
    median_income: 95000,
    median_age: 36,
    bachelors_pct: 68,
    age_distribution: {
      "18-24": 12,
      "25-34": 35,
      "35-44": 32,
      "45-54": 14,
      "55-64": 5,
      "65+": 2,
    },
    profile_type: "mixed_visitor",
    description: "Mix of shoppers, diners, and local visitors",
  },
};

/**
 * Zone characteristics that help determine visitor profile
 * Maps zone names/types to specific characteristics
 */
const ZONE_CHARACTERISTICS = {
  // Manhattan neighborhoods
  "soho": { visitor_profile: "shopping_luxury", shopping_heavy: true },
  "fifth-avenue": { visitor_profile: "shopping_luxury", shopping_heavy: true },
  "hudson-yards": { visitor_profile: "shopping_luxury", shopping_heavy: true },
  "madison-square": { visitor_profile: "shopping_luxury", shopping_heavy: true },
  
  "times-square": { visitor_profile: "tourist_attraction", tourist_heavy: true },
  "midtown": { visitor_profile: "tourist_attraction", tourist_heavy: true },
  "battery-park": { visitor_profile: "tourist_attraction", tourist_heavy: true },
  
  "financial-district": { visitor_profile: "business_visitor", business_heavy: true },
  "fidi": { visitor_profile: "business_visitor", business_heavy: true },
  "two-bridges": { visitor_profile: "business_visitor", business_heavy: true },
  
  "meatpacking": { visitor_profile: "entertainment_visitor", nightlife_heavy: true },
  "east-village": { visitor_profile: "entertainment_visitor", nightlife_heavy: true },
  "lower-east-side": { visitor_profile: "entertainment_visitor", nightlife_heavy: true },
  
  "museum-mile": { visitor_profile: "cultural_visitor", cultural_heavy: true },
  "lincoln-center": { visitor_profile: "cultural_visitor", cultural_heavy: true },
  "upper-east-side": { visitor_profile: "cultural_visitor", cultural_heavy: true },
  
  "chelsea": { visitor_profile: "dining_visitor", dining_heavy: true },
  "little-italy": { visitor_profile: "dining_visitor", dining_heavy: true },
  "chinatown": { visitor_profile: "dining_visitor", dining_heavy: true },
  
  "tribeca": { visitor_profile: "mixed_visitor", mixed_use: true },
  "west-village": { visitor_profile: "mixed_visitor", mixed_use: true },
  "greenwich-village": { visitor_profile: "mixed_visitor", mixed_use: true },
  "gramercy": { visitor_profile: "mixed_visitor", mixed_use: true },
  
  // Brooklyn neighborhoods
  "williamsburg": { visitor_profile: "entertainment_visitor", nightlife_heavy: true },
  "dumbo": { visitor_profile: "tourist_attraction", tourist_heavy: true },
  "brooklyn-heights": { visitor_profile: "cultural_visitor", cultural_heavy: true },
  "park-slope": { visitor_profile: "dining_visitor", dining_heavy: true },
  "bay-ridge": { visitor_profile: "local_visitor", residential: true },
  
  // Queens
  "astoria": { visitor_profile: "dining_visitor", dining_heavy: true },
  "long-island-city": { visitor_profile: "mixed_visitor", mixed_use: true },
  "flushing": { visitor_profile: "shopping_luxury", shopping_heavy: true },
};

/**
 * Get appropriate tourist/visitor profile for a zone
 * 
 * @param {string} zoneName - Zone name (e.g., "tribeca-man", "soho")
 * @param {string} zoneType - Zone type (business, tourist, residential, mixed, shopping)
 * @returns {object} Tourist profile with demographics
 */
function getTouristProfile(zoneName, zoneType) {
  // Normalize zone name for matching
  const normalizedName = zoneName.toLowerCase().replace(/-man$|-bk$|-qns$/, "");
  
  // Check if we have specific characteristics for this zone
  const characteristics = ZONE_CHARACTERISTICS[normalizedName];
  
  if (characteristics && characteristics.visitor_profile) {
    return {
      ...TOURIST_PROFILES[characteristics.visitor_profile],
      matched_by: "zone_name",
      zone_characteristics: characteristics,
    };
  }
  
  // Fall back to zone type
  switch (zoneType) {
    case "tourist":
      return {
        ...TOURIST_PROFILES.tourist_attraction,
        matched_by: "zone_type",
      };
    
    case "business":
      return {
        ...TOURIST_PROFILES.business_visitor,
        matched_by: "zone_type",
      };
    
    case "shopping":
      return {
        ...TOURIST_PROFILES.shopping_luxury,
        matched_by: "zone_type",
      };
    
    case "residential":
      return {
        ...TOURIST_PROFILES.local_visitor,
        matched_by: "zone_type",
      };
    
    case "mixed":
      return {
        ...TOURIST_PROFILES.mixed_visitor,
        matched_by: "zone_type",
      };
    
    default:
      // Generic fallback
      return {
        ...TOURIST_PROFILES.local_visitor,
        matched_by: "default",
      };
  }
}

/**
 * Calculate time-based audience weights
 * 
 * @param {string} zoneType - Zone type
 * @param {number} hour - Hour of day (0-23)
 * @param {number} dayOfWeek - Day of week (0=Sunday, 6=Saturday)
 * @returns {object} Weights for residential, workforce, tourist
 */
function calculateTimeWeights(zoneType, hour, dayOfWeek) {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isBusinessHours = hour >= 9 && hour <= 18;
  const isEveningDining = hour >= 18 && hour <= 22;
  const isLateNight = hour >= 22 || hour <= 5;
  const isMorningRush = hour >= 7 && hour <= 9;
  const isLunchTime = hour >= 12 && hour <= 14;
  
  let weights = { residential: 0.4, workforce: 0.4, tourist: 0.2 };
  let reasoning = "Default balanced weights";
  
  // Business districts
  if (zoneType === "business") {
    if (isWeekday && isBusinessHours) {
      weights = { residential: 0.05, workforce: 0.85, tourist: 0.10 };
      reasoning = "Business district during weekday business hours";
    } else if (isWeekday && isEveningDining) {
      weights = { residential: 0.20, workforce: 0.40, tourist: 0.40 };
      reasoning = "Business district during weekday evening (after-work dining)";
    } else if (!isWeekday && (hour >= 10 && hour <= 20)) {
      weights = { residential: 0.25, workforce: 0.15, tourist: 0.60 };
      reasoning = "Business district during weekend daytime";
    } else {
      weights = { residential: 0.60, workforce: 0.10, tourist: 0.30 };
      reasoning = "Business district during off hours";
    }
  }
  
  // Tourist areas
  else if (zoneType === "tourist") {
    if (hour >= 10 && hour <= 20) {
      weights = { residential: 0.10, workforce: 0.20, tourist: 0.70 };
      reasoning = "Tourist area during peak hours";
    } else if (isEveningDining) {
      weights = { residential: 0.15, workforce: 0.20, tourist: 0.65 };
      reasoning = "Tourist area during dinner hours";
    } else {
      weights = { residential: 0.40, workforce: 0.10, tourist: 0.50 };
      reasoning = "Tourist area during off-peak hours";
    }
  }
  
  // Shopping districts
  else if (zoneType === "shopping") {
    if (isWeekday && isLunchTime) {
      weights = { residential: 0.15, workforce: 0.45, tourist: 0.40 };
      reasoning = "Shopping area during weekday lunch";
    } else if ((isWeekday && (hour >= 10 && hour <= 18)) || (!isWeekday && (hour >= 10 && hour <= 20))) {
      weights = { residential: 0.15, workforce: 0.25, tourist: 0.60 };
      reasoning = "Shopping area during peak shopping hours";
    } else if (isEveningDining) {
      weights = { residential: 0.25, workforce: 0.25, tourist: 0.50 };
      reasoning = "Shopping area during evening";
    } else {
      weights = { residential: 0.60, workforce: 0.15, tourist: 0.25 };
      reasoning = "Shopping area during closed hours";
    }
  }
  
  // Residential
  else if (zoneType === "residential") {
    if (isWeekday && isBusinessHours) {
      weights = { residential: 0.30, workforce: 0.40, tourist: 0.30 };
      reasoning = "Residential during weekday (mixed with workers/shoppers)";
    } else if (isEveningDining) {
      weights = { residential: 0.60, workforce: 0.15, tourist: 0.25 };
      reasoning = "Residential during dinner hours";
    } else {
      weights = { residential: 0.70, workforce: 0.10, tourist: 0.20 };
      reasoning = "Residential during evening/weekend";
    }
  }
  
  // Mixed use
  else if (zoneType === "mixed") {
    if (isWeekday && isBusinessHours) {
      weights = { residential: 0.20, workforce: 0.60, tourist: 0.20 };
      reasoning = "Mixed zone during business hours";
    } else if (isEveningDining) {
      weights = { residential: 0.30, workforce: 0.30, tourist: 0.40 };
      reasoning = "Mixed zone during dining hours";
    } else if (isLateNight) {
      weights = { residential: 0.60, workforce: 0.15, tourist: 0.25 };
      reasoning = "Mixed zone during late night";
    } else {
      weights = { residential: 0.50, workforce: 0.20, tourist: 0.30 };
      reasoning = "Mixed zone during off hours";
    }
  }
  
  return { weights, reasoning };
}

module.exports = {
  TOURIST_PROFILES,
  ZONE_CHARACTERISTICS,
  getTouristProfile,
  calculateTimeWeights,
};








