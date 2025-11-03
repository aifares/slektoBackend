/**
 * Time period utilities for NYC timezone
 * Handles conversion from UTC to NYC local time and period classification
 */

/**
 * Convert UTC timestamp to NYC local time and get hour of day
 * @param {string|Date} timestamp - UTC timestamp
 * @returns {number} Hour in NYC local time (0-23)
 */
function getNYCHour(timestamp) {
  const date = new Date(timestamp);
  const nycHour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(date);
  return parseInt(nycHour);
}

/**
 * Get time period from timestamp in NYC timezone
 * @param {string|Date} timestamp - UTC timestamp
 * @returns {string} Time period: 'morning', 'afternoon', 'evening', or 'night'
 */
function getTimePeriod(timestamp) {
  const hour = getNYCHour(timestamp);

  if (hour >= 6 && hour < 12) {
    return "morning"; // 6am-12pm (6-11)
  } else if (hour >= 12 && hour < 18) {
    return "afternoon"; // 12pm-6pm (12-17)
  } else if (hour >= 18 && hour < 22) {
    return "evening"; // 6pm-10pm (18-21)
  } else {
    return "night"; // 10pm-6am (22-23, 0-5)
  }
}

/**
 * Calculate minutes into the day (0-1439) for NYC timezone
 * @param {Date} date - UTC timestamp
 * @returns {number} Minutes from midnight (0-1439)
 */
function getMinutesIntoDayNYC(date) {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(date)
  );
  const minute = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      minute: "numeric",
    }).format(date)
  );
  return hour * 60 + minute;
}

/**
 * Split minutes across time periods based on start and end timestamps
 * Handles cases where duration spans period boundaries, including day rollovers
 * @param {string|Date} startTime - Start timestamp (UTC)
 * @param {string|Date} endTime - End timestamp (UTC)
 * @param {number} totalMinutes - Total minutes to split
 * @returns {Object} Object with minutes per period: {morning, afternoon, evening, night}
 */
function splitMinutesAcrossPeriods(startTime, endTime, totalMinutes) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  // Get periods for start and end using NYC timezone
  const startPeriod = getTimePeriod(start);
  const endPeriod = getTimePeriod(end);

  // If both timestamps are in the same period, attribute all minutes to that period
  if (startPeriod === endPeriod) {
    const result = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    result[startPeriod] = totalMinutes;
    return result;
  }

  // Period boundaries in minutes from midnight (NYC time)
  const PERIOD_BOUNDARIES = {
    morning: 6 * 60, // 6:00 AM = 360 minutes
    afternoon: 12 * 60, // 12:00 PM = 720 minutes
    evening: 18 * 60, // 6:00 PM = 1080 minutes
    night: 22 * 60, // 10:00 PM = 1320 minutes
  };

  const result = { morning: 0, afternoon: 0, evening: 0, night: 0 };

  // Helper to determine which period a minute offset falls into
  const getPeriodForMinute = (minutesInDay) => {
    if (
      minutesInDay >= PERIOD_BOUNDARIES.morning &&
      minutesInDay < PERIOD_BOUNDARIES.afternoon
    ) {
      return "morning";
    } else if (
      minutesInDay >= PERIOD_BOUNDARIES.afternoon &&
      minutesInDay < PERIOD_BOUNDARIES.evening
    ) {
      return "afternoon";
    } else if (
      minutesInDay >= PERIOD_BOUNDARIES.evening &&
      minutesInDay < PERIOD_BOUNDARIES.night
    ) {
      return "evening";
    } else {
      return "night"; // Covers 22:00-23:59 and 00:00-05:59
    }
  };

  // For GPS points that are typically 3 minutes apart, use a proportional split
  // Calculate the midpoint time in NYC timezone
  const actualDiffMs = end - start;
  const midpointMs = start.getTime() + actualDiffMs / 2;
  const midpointDate = new Date(midpointMs);
  const midpointMinutesInDay = getMinutesIntoDayNYC(midpointDate);
  const midpointPeriod = getPeriodForMinute(midpointMinutesInDay);

  // Calculate what proportion of the duration falls in each period
  // For short durations (GPS points are ~3 min apart), use a simplified approach
  if (totalMinutes <= 10) {
    // For short durations, attribute based on which periods the start and end fall into
    const periodsInvolved = new Set([startPeriod, endPeriod, midpointPeriod]);

    // If duration is very short (<= 3 min), most time is likely in midpoint period
    if (totalMinutes <= 3) {
      // 80% to midpoint, 20% split between start/end if different
      result[midpointPeriod] = totalMinutes * 0.8;
      const remaining = totalMinutes * 0.2;

      if (startPeriod !== midpointPeriod) {
        result[startPeriod] = remaining * 0.5;
      }
      if (endPeriod !== midpointPeriod && endPeriod !== startPeriod) {
        result[endPeriod] = remaining * 0.5;
      }
      if (startPeriod === midpointPeriod && endPeriod === midpointPeriod) {
        result[midpointPeriod] = totalMinutes;
      }
    } else {
      // For slightly longer durations (3-10 min), distribute more evenly
      const numPeriods = periodsInvolved.size;
      const perPeriod = totalMinutes / numPeriods;
      periodsInvolved.forEach((period) => {
        result[period] += perPeriod;
      });
    }
  } else {
    // For longer durations, calculate exact boundaries
    // Split proportionally: more weight to midpoint period
    result[midpointPeriod] = totalMinutes * 0.6;
    const remaining = totalMinutes * 0.4;

    if (startPeriod !== midpointPeriod && endPeriod !== midpointPeriod) {
      result[startPeriod] = remaining * 0.5;
      result[endPeriod] = remaining * 0.5;
    } else if (startPeriod !== midpointPeriod) {
      result[startPeriod] = remaining;
    } else if (endPeriod !== midpointPeriod) {
      result[endPeriod] = remaining;
    } else {
      result[midpointPeriod] = totalMinutes;
    }
  }

  // Normalize to ensure total equals totalMinutes exactly
  const currentTotal =
    result.morning + result.afternoon + result.evening + result.night;
  if (currentTotal > 0 && Math.abs(currentTotal - totalMinutes) > 0.001) {
    const ratio = totalMinutes / currentTotal;
    result.morning = result.morning * ratio;
    result.afternoon = result.afternoon * ratio;
    result.evening = result.evening * ratio;
    result.night = result.night * ratio;
  }

  return result;
}

module.exports = {
  getNYCHour,
  getTimePeriod,
  getMinutesIntoDayNYC,
  splitMinutesAcrossPeriods,
};

