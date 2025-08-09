const COLORLIGHT_TRACK_URL =
  "https://us33.colorlightcloud.com/wp-json/led/v3/monitor/query/track";
const COLORLIGHT_LATEST_URL =
  "https://us33.colorlightcloud.com/wp-json/led/v3/monitor/query/latest/single";

const credentials = "AliFares:Hx123456@#";
const encodedCredentials = Buffer.from(credentials).toString("base64");

const TRACK_AUTH_HEADER = {
  headers: {
    Authorization: `Basic ${encodedCredentials}`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    Referer: "https://us33.colorlightcloud.com/map",
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    DNT: "1",
    "sec-ch-ua":
      '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
  },
};

const TERMINAL_ID = "2355209";

module.exports = {
  COLORLIGHT_TRACK_URL,
  COLORLIGHT_LATEST_URL,
  TRACK_AUTH_HEADER,
  TERMINAL_ID,
};
