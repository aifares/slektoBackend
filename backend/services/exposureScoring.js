/**
 * Exposure Scoring Service
 * 
 * Calculates enhanced exposure scores that combine:
 * - Traditional weighted exposure (time × density)
 * - Demographic value based on income, education, and audience composition
 * 
 * Formula:
 *   audience_value_score = income_factor × education_factor × audience_quality
 *   enhanced_exposure = weighted_exposure × (1 + demographic_value_multiplier)
 */

// Baseline values for normalization
const BASELINE_INCOME = 75000;  // Median US household income
const BASELINE_EDUCATION = 35;  // US average bachelor's degree rate

/**
 * Calculate audience composition weights based on time of day/week
 * Different times attract different audiences (workers, residents, tourists)
 * 
 * Time periods from RPC:
 * - weekday_business: 9am-6pm Mon-Fri (workers dominate)
 * - weekday_evening: 6pm-11pm Mon-Fri (residents + some tourists)
 * - weekend: All day Sat/Sun (tourists + residents)
 * - other: Early morning/late night weekdays (commuters + residents)
 * 
 * @param {Object} timePeriodBreakdown - {weekday_business, weekday_evening, weekend, other}
 * @returns {Object} - {worker_weight, resident_weight, tourist_weight}
 */
function calculateAudienceWeights(timePeriodBreakdown) {
  if (!timePeriodBreakdown) {
    return { worker_weight: 0.33, resident_weight: 0.34, tourist_weight: 0.33 };
  }

  const business = timePeriodBreakdown.weekday_business?.minutes || 0;
  const evening = timePeriodBreakdown.weekday_evening?.minutes || 0;
  const weekend = timePeriodBreakdown.weekend?.minutes || 0;
  const other = timePeriodBreakdown.other?.minutes || 0;
  
  const total = business + evening + weekend + other;
  if (total === 0) {
    return { worker_weight: 0.33, resident_weight: 0.34, tourist_weight: 0.33 };
  }

  // Calculate weights based on when people are likely to be where:
  // - Business hours (9-6 weekday): 70% workers, 15% residents, 15% tourists
  // - Evening (6-11 weekday): 15% workers, 55% residents, 30% tourists  
  // - Weekend: 5% workers, 45% residents, 50% tourists
  // - Other (early AM/late night): 30% workers (commuters), 65% residents, 5% tourists
  
  const workerWeight = 
    (business / total) * 0.70 + 
    (evening / total) * 0.15 + 
    (weekend / total) * 0.05 + 
    (other / total) * 0.30;  // Early morning = commuters heading to work
    
  const residentWeight = 
    (business / total) * 0.15 + 
    (evening / total) * 0.55 + 
    (weekend / total) * 0.45 + 
    (other / total) * 0.65;  // Early morning/late night = mostly residents
    
  const touristWeight = 
    (business / total) * 0.15 + 
    (evening / total) * 0.30 + 
    (weekend / total) * 0.50 + 
    (other / total) * 0.05;  // Few tourists at 6am or midnight

  // Normalize to sum to 1 (should already be close)
  const sum = workerWeight + residentWeight + touristWeight;
  return {
    worker_weight: sum > 0 ? Math.round((workerWeight / sum) * 100) / 100 : 0.33,
    resident_weight: sum > 0 ? Math.round((residentWeight / sum) * 100) / 100 : 0.34,
    tourist_weight: sum > 0 ? Math.round((touristWeight / sum) * 100) / 100 : 0.33
  };
}

/**
 * Calculate blended demographics based on audience composition
 * 
 * @param {Object} residential - {median_income, median_age, bachelors_pct}
 * @param {Object} workforce - {median_income, median_age, bachelors_pct}  
 * @param {Object} tourist - {median_income, median_age, bachelors_pct}
 * @param {Object} weights - {worker_weight, resident_weight, tourist_weight}
 * @returns {Object} - Blended demographic profile
 */
function blendDemographics(residential, workforce, tourist, weights) {
  const res = residential || {};
  const wf = workforce || {};
  const tour = tourist || {};

  // Use fallback values if data is missing
  const resIncome = res.median_income || BASELINE_INCOME;
  const wfIncome = wf.median_income || BASELINE_INCOME * 1.2;
  const tourIncome = tour.median_income || BASELINE_INCOME;

  const resEducation = res.bachelors_pct || BASELINE_EDUCATION;
  const wfEducation = wf.bachelors_pct || BASELINE_EDUCATION * 1.2;
  const tourEducation = tour.bachelors_pct || BASELINE_EDUCATION;

  const resAge = res.median_age || 38;
  const wfAge = wf.median_age || 35;
  const tourAge = tour.median_age || 35;

  return {
    blended_income: Math.round(
      resIncome * weights.resident_weight +
      wfIncome * weights.worker_weight +
      tourIncome * weights.tourist_weight
    ),
    blended_education: Math.round(
      (resEducation * weights.resident_weight +
       wfEducation * weights.worker_weight +
       tourEducation * weights.tourist_weight) * 10
    ) / 10,
    blended_age: Math.round(
      (resAge * weights.resident_weight +
       wfAge * weights.worker_weight +
       tourAge * weights.tourist_weight) * 10
    ) / 10
  };
}

/**
 * Calculate the demographic value multiplier
 * Higher income and education = higher multiplier
 * 
 * @param {number} income - Blended median income
 * @param {number} educationPct - Blended bachelor's percentage
 * @returns {number} - Multiplier between 0.5 and 2.0
 */
function calculateDemographicMultiplier(income, educationPct) {
  // Income factor: 0.7 to 1.5 based on income relative to baseline
  const incomeRatio = income / BASELINE_INCOME;
  const incomeFactor = Math.min(1.5, Math.max(0.7, 0.5 + (incomeRatio * 0.5)));

  // Education factor: 0.8 to 1.3 based on education relative to baseline
  const educationRatio = educationPct / BASELINE_EDUCATION;
  const educationFactor = Math.min(1.3, Math.max(0.8, 0.7 + (educationRatio * 0.3)));

  // Combined multiplier: 0.5 to 2.0
  const combined = incomeFactor * educationFactor;
  return Math.min(2.0, Math.max(0.5, Math.round(combined * 100) / 100));
}

/**
 * Determine quality tier based on demographic multiplier
 * 
 * @param {number} multiplier - Demographic value multiplier
 * @returns {string} - Quality tier: 'premium', 'high', 'standard', 'economy'
 */
function getQualityTier(multiplier) {
  if (multiplier >= 1.5) return 'premium';
  if (multiplier >= 1.2) return 'high';
  if (multiplier >= 0.9) return 'standard';
  return 'economy';
}

/**
 * Calculate enhanced exposure score for a zone
 * 
 * @param {Object} zone - Zone data from RPC
 * @returns {Object} - Enhanced zone data with demographic scoring
 */
function calculateEnhancedExposure(zone) {
  const {
    weighted_exposure,
    residential_demographics: res,
    workforce_demographics: wf,
    tourist_demographics: tour,
    time_period_breakdown: timePeriods
  } = zone;

  // Calculate audience weights based on when terminal was in zone
  const audienceWeights = calculateAudienceWeights(timePeriods);
  
  // Blend demographics based on audience composition
  const blended = blendDemographics(res, wf, tour, audienceWeights);
  
  // Calculate demographic value multiplier
  const demographicMultiplier = calculateDemographicMultiplier(
    blended.blended_income,
    blended.blended_education
  );
  
  // Calculate enhanced exposure
  const enhancedExposure = Math.round(
    weighted_exposure * (1 + (demographicMultiplier - 1) * 0.5) * 100
  ) / 100;

  return {
    // Original weighted exposure preserved for backwards compatibility
    weighted_exposure: Number(weighted_exposure),
    
    // NEW: Demographics-enhanced fields
    demographics_enhanced_exposure: enhancedExposure,
    demographic_value_multiplier: demographicMultiplier,
    audience_quality_tier: getQualityTier(demographicMultiplier),
    
    // Audience composition
    audience_composition: {
      worker_pct: Math.round(audienceWeights.worker_weight * 100),
      resident_pct: Math.round(audienceWeights.resident_weight * 100),
      tourist_pct: Math.round(audienceWeights.tourist_weight * 100)
    },
    
    // Blended demographics (time-weighted average across all audience types)
    blended_demographics: blended,
    
    // Raw demographic data for detailed analysis
    demographics: {
      residential: res || null,
      workforce: wf || null,
      tourist: tour || null
    }
  };
}

/**
 * Calculate aggregate demographics summary for a program
 * 
 * @param {Array} zones - Array of zones with enhanced exposure data
 * @returns {Object} - Aggregate demographics summary
 */
function calculateAggregateDemographics(zones) {
  if (!zones || zones.length === 0) {
    return null;
  }

  let totalMinutes = 0;
  let weightedIncome = 0;
  let weightedEducation = 0;
  let weightedAge = 0;
  let totalEnhancedExposure = 0;
  let totalWeightedExposure = 0;

  const tierCounts = { premium: 0, high: 0, standard: 0, economy: 0 };

  for (const zone of zones) {
    const minutes = zone.minutes_spent || 0;
    const blended = zone.blended_demographics || {};
    
    totalMinutes += minutes;
    weightedIncome += (blended.blended_income || BASELINE_INCOME) * minutes;
    weightedEducation += (blended.blended_education || BASELINE_EDUCATION) * minutes;
    weightedAge += (blended.blended_age || 35) * minutes;
    
    totalEnhancedExposure += zone.demographics_enhanced_exposure || zone.weighted_exposure || 0;
    totalWeightedExposure += zone.weighted_exposure || 0;
    
    const tier = zone.audience_quality_tier || 'standard';
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  if (totalMinutes === 0) {
    return null;
  }

  const avgIncome = Math.round(weightedIncome / totalMinutes);
  const avgEducation = Math.round((weightedEducation / totalMinutes) * 10) / 10;
  const avgAge = Math.round((weightedAge / totalMinutes) * 10) / 10;
  const avgMultiplier = calculateDemographicMultiplier(avgIncome, avgEducation);

  return {
    weighted_average_income: avgIncome,
    weighted_average_education: avgEducation,
    weighted_average_age: avgAge,
    overall_demographic_multiplier: avgMultiplier,
    overall_quality_tier: getQualityTier(avgMultiplier),
    total_enhanced_exposure: Math.round(totalEnhancedExposure * 100) / 100,
    total_weighted_exposure: Math.round(totalWeightedExposure * 100) / 100,
    exposure_uplift_percent: totalWeightedExposure > 0 
      ? Math.round(((totalEnhancedExposure / totalWeightedExposure) - 1) * 1000) / 10
      : 0,
    zone_quality_distribution: {
      premium_zones: tierCounts.premium,
      high_zones: tierCounts.high,
      standard_zones: tierCounts.standard,
      economy_zones: tierCounts.economy
    }
  };
}

module.exports = {
  calculateEnhancedExposure,
  calculateAggregateDemographics,
  calculateAudienceWeights,
  blendDemographics,
  calculateDemographicMultiplier,
  getQualityTier,
  BASELINE_INCOME,
  BASELINE_EDUCATION
};
