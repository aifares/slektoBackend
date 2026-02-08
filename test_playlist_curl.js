const axios = require("axios");

const COLORLIGHT_AUTH = "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==";
const BASE_URL = "https://us33.colorlightcloud.com";
const SESSION_COOKIE =
  "SESSION=NDRjMjFlZGEtOWI1Zi00NWFiLTg4YzQtODQ1Y2Q2ZjAyYmVl";

// Use exact payload from working curl, just change fileID
async function testCreatePlaylist(fileID) {
  const payload = {
    title: "testPlaylist4",
    Terminalgroup: [],
    program_info: {
      name: "testPlaylist4",
      displayName: "testPlaylist4",
      isCrop: 0,
      id: 10,
      type: "contents",
      version: 4,
      selectChild: 0,
      addNum: 2,
      overStage: false,
      info: {
        Information: { Width: 160, Height: 120, Scale: 1 },
        Pages: [],
      },
      children: [
        {
          name: "Page2",
          id: 13,
          index: 2,
          type: "page",
          selectChild: 0,
          addNum: 1,
          info: {
            AppointDuration: 3600000,
            Opacity: 1,
            LoopType: 1,
            BgColor: "0xFF000000",
            Regions: [],
          },
          children: [
            {
              name: "File Window",
              id: 14,
              index: 1,
              type: "fileWindow",
              vsnType: 3,
              Rect: {
                X: 0,
                Y: 0,
                Width: 160,
                Height: 120,
                BorderWidth: 0,
                BorderColor: "#ffff00",
              },
              IsScheduleRegion: 0,
              selectChild: null,
              children: [
                {
                  id: 0.2158103358723068,
                  file_type: "jpg",
                  author: "AliFares",
                  date: "2026-02-02 21:36:57",
                  modified_gmt: "2026-02-03T02:36:57Z",
                  date_gmt: "2026-02-03T02:36:57Z",
                  GMTDate: "2026-02-03T02:36:57Z",
                  name: "testimage2.jpg",
                  type: "image",
                  src: "https://us33.colorlightcloud.com:443/wp-content/upload/2025/9/F_A65E980D6F11FDB8B0A6539E18A16EC9_18813-200x200.jpg",
                  format_size: "18.4 KB",
                  attachment_program: [],
                  attachment_program_detail: [],
                  source_url:
                    "https://us33.colorlightcloud.com:443/wp-content/Tus/uploads/8dc1f295-0990-4138-a1bf-810cdcf6b30a/F_A65E980D6F11FDB8B0A6539E18A16EC9_18813.jpg",
                  disdelete: false,
                  thumbnailSize: { width: 200, height: 156 },
                  fullSize: { width: 404, height: 316 },
                  videoSize: { width: null, height: null },
                  length: null,
                  durationInSecond: null,
                  playLength: null,
                  mshare: [],
                  mfolder: null,
                  duration: null,
                  aws: {},
                  IsSchedule: 0,
                  Schedule: {
                    IsLimitTime: 0,
                    StartTime: "00:00:00",
                    EndTime: "23:59:59",
                    IsLimitDate: 0,
                    StartDay: "2026/2/2",
                    StartDayTime: "00:00:00",
                    EndDay: "2026/2/2",
                    EndDayTime: "23:59:59",
                    IsLimitWeek: 0,
                    LimitWeek: [1, 1, 1, 1, 1, 1, 1],
                  },
                  shareWithMe: false,
                  Trigger: { Type: "lightStrip", Value: "0" },
                  customTags: [],
                  source: "MEDIA.WEB",
                  hover: true,
                  fileID: fileID,
                  Duration: 8000,
                  isShowAspectBtn: false,
                  ReserveAS: 0,
                  playTime: 8,
                  PlayTimes: "1",
                  inEffect: {
                    Name: "No Effect",
                    Type: 0,
                    Time: 1500,
                    webTime: 1.5,
                  },
                },
              ],
              badge: "73647",
              icon: "perm_media",
              pagesTextShot: true,
            },
          ],
          imgDataUrl: null,
          ifShowPageConfig: false,
        },
      ],
      nodeIdjia: 14,
      previewDataUrl: null,
      duration: 0,
    },
    Programs: {
      Program: {
        Information: { Width: 160, Height: 120, Scale: 1 },
        Pages: [
          {
            AppointDuration: 3600000,
            Opacity: 1,
            LoopType: 1,
            BgColor: "0xFF000000",
            Regions: [
              {
                type: 3,
                Layer: 1,
                Rect: {
                  X: 0,
                  Y: 0,
                  Width: 160,
                  Height: 120,
                  BorderWidth: 0,
                  BorderColor: "#ffff00",
                },
                Name: "File_Window",
                IsScheduleRegion: 0,
                Items: [
                  {
                    Type: 2,
                    Alhpa: "1.000000",
                    Duration: 8000,
                    PlayTimes: "1",
                    inEffect: {
                      Name: "No Effect",
                      Type: 0,
                      Time: 1500,
                      webTime: 1.5,
                    },
                    Schedule: {
                      IsLimitTime: 0,
                      StartTime: "00:00:00",
                      EndTime: "23:59:59",
                      IsLimitDate: 0,
                      StartDay: "2026/2/2",
                      StartDayTime: "00:00:00",
                      EndDay: "2026/2/2",
                      EndDayTime: "23:59:59",
                      IsLimitWeek: 0,
                      LimitWeek: "1,1,1,1,1,1,1",
                    },
                    Trigger: { Type: "lightStrip", Value: "0" },
                    FileSource: {
                      IsRelative: 1,
                      FilePath: "",
                      Resource_ID: fileID,
                      OriginName: "testimage2.jpg",
                    },
                    ReserveAS: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    status: "publish",
  };

  // Debug: save payload to file
  const fs = require("fs");
  fs.writeFileSync("test_payload.json", JSON.stringify(payload, null, 2));
  console.log("Payload saved to test_payload.json");

  try {
    const response = await axios.post(
      `${BASE_URL}/wp-json/wp/v2/programs`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: COLORLIGHT_AUTH,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          Referer: `${BASE_URL}/create;type=file`,
          Accept: "application/json, text/plain, */*",
          "sec-ch-ua":
            '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          Cookie: SESSION_COOKIE,
        },
      },
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

// Test with the last uploaded fileID
testCreatePlaylist(2751923);
