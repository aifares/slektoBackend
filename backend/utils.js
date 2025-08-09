const COLORLIGHT_BASE_URL =
  "https://us33.colorlightcloud.com/wp-json/wp/v2/leds";
const AUTH_HEADER = {
  headers: {
    Authorization: "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==",
    "User-Agent": "Mozilla/5.0",
    Referer: "https://us33.colorlightcloud.com/home",
    Accept: "application/json",
  },
};

const TERMINAL_ID = "2355209";

module.exports = {
  COLORLIGHT_BASE_URL,
  AUTH_HEADER,
  TERMINAL_ID,
};
