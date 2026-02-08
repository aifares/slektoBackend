const axios = require("axios");
const fs = require("fs");

const COLORLIGHT_AUTH = "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==";
const BASE_URL = "https://us33.colorlightcloud.com";
const SESSION_COOKIE = "SESSION=NDRjMjFlZGEtOWI1Zi00NWFiLTg4YzQtODQ1Y2Q2ZjAyYmVl";

async function createPlaylist(playlistName) {
  // Load the working payload and update the name
  const payload = JSON.parse(fs.readFileSync("testPayload.json", "utf8"));
  
  // Update all name fields
  payload.title = playlistName;
  payload.program_info.name = playlistName;
  payload.program_info.displayName = playlistName;

  try {
    const response = await axios.post(
      `${BASE_URL}/wp-json/wp/v2/programs`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: COLORLIGHT_AUTH,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          Referer: `${BASE_URL}/create;type=file`,
          Accept: "application/json, text/plain, */*",
          "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          Cookie: SESSION_COOKIE,
        },
      }
    );

    console.log("SUCCESS!");
    console.log("Playlist ID:", response.data.id);
    return response.data;
  } catch (error) {
    console.error("Failed:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

createPlaylist("testPlaylist4");
