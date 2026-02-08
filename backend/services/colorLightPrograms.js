const axios = require("axios");
const { supabase } = require("../config/supabase");

// ColorLight API configuration
const COLORLIGHT_BASE_URL = "https://us33.colorlightcloud.com";
const COLORLIGHT_AUTH = "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==";

/**
 * Fetch a program from ColorLight API
 * @param {number} programId - ColorLight program ID
 * @returns {Promise<Object>} Program data
 */
async function fetchProgramFromColorLight(programId) {
  try {
    const response = await axios.get(
      `${COLORLIGHT_BASE_URL}/wp-json/wp/v2/programs/${programId}/programInfo`,
      {
        headers: {
          Authorization: COLORLIGHT_AUTH,
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Referer: `${COLORLIGHT_BASE_URL}/contents`,
        },
      },
    );

    // Response has data as a JSON string under the 'data' field
    let programData = response.data;
    if (typeof programData.data === "string") {
      programData = JSON.parse(programData.data);
    } else if (programData.data) {
      programData = programData.data;
    }

    return programData;
  } catch (error) {
    console.error(`Failed to fetch program ${programId}:`, error.message);
    if (error.response) {
      console.error(`Response status: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
    }
    throw new Error(
      `Failed to fetch program from ColorLight: ${error.message}`,
    );
  }
}

/**
 * Update a program on ColorLight API
 * @param {number} programId - ColorLight program ID
 * @param {Object} payload - Transformed program payload
 * @returns {Promise<Object>} Update response
 */
async function updateProgramOnColorLight(programId, payload) {
  try {
    // Try PUT to base programs endpoint (without /programInfo)
    const response = await axios.put(
      `${COLORLIGHT_BASE_URL}/wp-json/wp/v2/programs/${programId}`,
      payload,
      {
        headers: {
          Authorization: COLORLIGHT_AUTH,
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Referer: `${COLORLIGHT_BASE_URL}/contents`,
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error(`Failed to update program ${programId}:`, error.message);
    if (error.response) {
      console.error(`Response status: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
    }
    throw new Error(`Failed to update program on ColorLight: ${error.message}`);
  }
}

// NOTE: findPagesToDelete, transformProgramForUpdate, and removeClientFilesFromProgram
// have been replaced by the schedule-driven approach in playlistSchedule.js and colorLight.js.
// Use colorLight.js for all new ColorLight API interactions.

module.exports = {
  fetchProgramFromColorLight,
  updateProgramOnColorLight,
};
