const axios = require("axios");
const FormData = require("form-data");
const { Readable } = require("stream");

const COLORLIGHT_AUTH = "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==";
const BASE_URL = "https://us33.colorlightcloud.com";
const SESSION_COOKIE =
  "SESSION=NDRjMjFlZGEtOWI1Zi00NWFiLTg4YzQtODQ1Y2Q2ZjAyYmVl";

// Placeholder base64 image for imgDataUrl/previewDataUrl
const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const COMMON_HEADERS = {
  Authorization: COLORLIGHT_AUTH,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

const PROGRAM_HEADERS = {
  ...COMMON_HEADERS,
  "Content-Type": "application/json",
  Referer: `${BASE_URL}/create;type=file`,
  "sec-ch-ua":
    '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  Cookie: SESSION_COOKIE,
};

/**
 * Upload a single image buffer to ColorLight media library
 * @param {Buffer} buffer - Image file buffer
 * @param {string} filename - Original filename
 * @param {string} mimetype - MIME type (e.g. image/jpeg)
 * @returns {Promise<Object>} ColorLight media response (includes id, source_url, etc.)
 */
async function uploadImageToColorLight(buffer, filename, mimetype) {
  const form = new FormData();

  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  form.append("file", stream, {
    filename: filename,
    contentType: mimetype || "image/jpeg",
  });

  const response = await axios.post(
    `${BASE_URL}/wp-json/wp/v2/media?title=${encodeURIComponent(filename)}`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        ...COMMON_HEADERS,
        Referer: `${BASE_URL}/media`,
      },
    }
  );

  console.log(`✅ Uploaded to ColorLight: ${filename} (ID: ${response.data.id})`);
  return response.data;
}

/**
 * Upload multiple image buffers to ColorLight
 * @param {Array<{buffer: Buffer, filename: string, mimetype: string}>} files
 * @returns {Promise<Array<Object>>} Array of ColorLight media responses
 */
async function uploadImagesToColorLight(files) {
  const results = [];
  for (const file of files) {
    const result = await uploadImageToColorLight(
      file.buffer,
      file.filename,
      file.mimetype
    );
    results.push(result);
  }
  return results;
}

/**
 * Create a new program (playlist) on ColorLight with the given images
 * @param {string} programName - Name for the program
 * @param {Array<Object>} uploadedImages - Array of ColorLight media responses from uploadImageToColorLight
 * @param {Object} options - { width, height, defaultDuration }
 * @returns {Promise<Object>} Created program response
 */
async function createProgram(programName, uploadedImages, options = {}) {
  const { width = 160, height = 120, defaultDuration = 8000 } = options;

  if (!uploadedImages || uploadedImages.length === 0) {
    throw new Error("At least one image is required to create a program");
  }

  const pages = uploadedImages.map((image, index) => {
    const imageData = extractImageData(image);
    return buildPage(imageData, index + 2, width, height, defaultDuration);
  });

  const payload = buildPlaylistPayload(programName, pages, width, height);

  const response = await axios.post(
    `${BASE_URL}/wp-json/wp/v2/programs`,
    payload,
    { headers: PROGRAM_HEADERS }
  );

  console.log(`✅ Created program: ${programName} (ID: ${response.data.id})`);
  return response.data;
}

/**
 * Fetch a program from ColorLight API
 * @param {number} programId - ColorLight program ID
 * @returns {Promise<Object>} Program data
 */
async function fetchProgram(programId) {
  const response = await axios.get(
    `${BASE_URL}/wp-json/wp/v2/programs/${programId}/programInfo`,
    { headers: COMMON_HEADERS }
  );

  let programData = response.data;
  if (typeof programData.data === "string") {
    programData = JSON.parse(programData.data);
  } else if (programData.data) {
    programData = programData.data;
  }

  return programData;
}

/**
 * Update a program on ColorLight with a pre-built payload
 * @param {number} programId - Program ID to update
 * @param {Object} payload - Full program payload
 * @returns {Promise<Object>} Update response
 */
async function updateProgram(programId, payload) {
  const response = await axios.put(
    `${BASE_URL}/wp-json/wp/v2/programs/${programId}`,
    payload,
    { headers: PROGRAM_HEADERS }
  );

  console.log(`✅ Updated program ${programId}`);
  return response.data;
}

/**
 * Build a playlist payload from a set of image children (already in ColorLight format)
 * Used by the playlist schedule service to build transition states
 * @param {Object} programData - Existing program data from fetchProgram
 * @param {Array<Object>} remainingPages - Filtered children (pages to keep)
 * @returns {Object} Ready-to-PUT payload
 */
function buildPayloadFromExistingPages(programData, remainingPages) {
  let newSelectChild = programData.selectChild;
  if (newSelectChild >= remainingPages.length) {
    newSelectChild = Math.max(0, remainingPages.length - 1);
  }

  const programInfo = {
    ...programData,
    children: remainingPages,
    selectChild: newSelectChild,
  };

  const transformedPages = remainingPages.map((page) => {
    const regions = [];

    if (page.children && Array.isArray(page.children)) {
      page.children.forEach((fileWindow) => {
        if (fileWindow.type === "fileWindow") {
          const items = [];

          if (fileWindow.children && Array.isArray(fileWindow.children)) {
            fileWindow.children.forEach((file) => {
              items.push({
                Type: 2,
                Alhpa: "1.000000",
                Duration: file.Duration || 8000,
                PlayTimes: file.PlayTimes || "1",
                inEffect: file.inEffect || {
                  Name: "No Effect",
                  Type: 0,
                  Time: 1500,
                  webTime: 1.5,
                },
                Schedule: {
                  IsLimitTime: file.Schedule?.IsLimitTime || 0,
                  StartTime: file.Schedule?.StartTime || "00:00:00",
                  EndTime: file.Schedule?.EndTime || "23:59:59",
                  IsLimitDate: file.Schedule?.IsLimitDate || 0,
                  StartDay: file.Schedule?.StartDay || "",
                  StartDayTime: file.Schedule?.StartDayTime || "00:00:00",
                  EndDay: file.Schedule?.EndDay || "",
                  EndDayTime: file.Schedule?.EndDayTime || "23:59:59",
                  IsLimitWeek: file.Schedule?.IsLimitWeek || 0,
                  LimitWeek: Array.isArray(file.Schedule?.LimitWeek)
                    ? file.Schedule.LimitWeek.join(",")
                    : "1,1,1,1,1,1,1",
                },
                Trigger: file.Trigger || {
                  Type: "lightStrip",
                  Value: "0",
                },
                FileSource: {
                  IsRelative: 1,
                  FilePath: "",
                  Resource_ID: file.fileID,
                  OriginName: file.name,
                },
                ReserveAS: file.ReserveAS || 0,
              });
            });
          }

          regions.push({
            type: fileWindow.vsnType || 3,
            Layer: 1,
            Rect: fileWindow.Rect || {
              X: 0,
              Y: 0,
              Width: 160,
              Height: 120,
              BorderWidth: 0,
              BorderColor: "#ffff00",
            },
            Name: fileWindow.name || "File_Window",
            IsScheduleRegion: fileWindow.IsScheduleRegion || 0,
            Items: items,
          });
        }
      });
    }

    return {
      AppointDuration: page.info?.AppointDuration || 3600000,
      Opacity: page.info?.Opacity || 1,
      LoopType: page.info?.LoopType || 1,
      BgColor: page.info?.BgColor || "0xFF000000",
      Regions: regions,
    };
  });

  return {
    title: programData.name || programData.displayName,
    Terminalgroup: [],
    program_info: programInfo,
    Programs: {
      Program: {
        Information: programData.info?.Information || {
          Width: 160,
          Height: 120,
          Scale: 1,
        },
        Pages: transformedPages,
      },
    },
  };
}

// ============================================================
// Helper functions (from upload_and_create_playlist.js)
// ============================================================

function extractImageData(uploadResponse) {
  const data = uploadResponse.data || uploadResponse;

  return {
    fileID: data.id,
    name: data.title?.rendered || data.name || data.originalname,
    source_url: data.source_url || data.guid?.rendered,
    src: data.media_details?.sizes?.thumbnail?.source_url || data.src,
    fullSize: {
      width: data.media_details?.width || data.fullSize?.width,
      height: data.media_details?.height || data.fullSize?.height,
    },
    thumbnailSize: {
      width:
        data.media_details?.sizes?.thumbnail?.width ||
        data.thumbnailSize?.width ||
        200,
      height:
        data.media_details?.sizes?.thumbnail?.height ||
        data.thumbnailSize?.height ||
        200,
    },
    file_type: data.file_type || data.mime_type?.split("/")[1] || "jpg",
    format_size: data.format_size || "0 KB",
    author: data.author?.toString() || "AliFares",
    date_gmt: data.date_gmt || data.modified_gmt || new Date().toISOString(),
    modified_gmt:
      data.modified_gmt || data.date_gmt || new Date().toISOString(),
    attachment_program: data.attachment_program || [],
    attachment_program_detail: data.attachment_program_detail || [],
  };
}

function buildPage(imageData, pageIndex, width, height, duration) {
  const pageId = 11 + pageIndex;
  const windowId = pageId + 1;

  return {
    name: `Page${pageIndex}`,
    id: pageId,
    index: pageIndex,
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
        id: windowId,
        index: 1,
        type: "fileWindow",
        vsnType: 3,
        Rect: {
          X: 0,
          Y: 0,
          Width: width,
          Height: height,
          BorderWidth: 0,
          BorderColor: "#ffff00",
        },
        IsScheduleRegion: 0,
        selectChild: null,
        children: [buildImageChild(imageData, duration)],
        badge: "73647",
        icon: "perm_media",
        pagesTextShot: true,
      },
    ],
    imgDataUrl: PLACEHOLDER_IMAGE,
    ifShowPageConfig: false,
  };
}

function buildImageChild(imageData, duration) {
  return {
    id: Math.random(),
    file_type: imageData.file_type,
    author: imageData.author,
    date:
      imageData.date_gmt?.replace("T", " ").substring(0, 19) ||
      new Date().toISOString().replace("T", " ").substring(0, 19),
    modified_gmt: imageData.modified_gmt,
    date_gmt: imageData.date_gmt,
    GMTDate: imageData.date_gmt,
    name: imageData.name,
    type: "image",
    src: imageData.src,
    format_size: imageData.format_size,
    attachment_program: imageData.attachment_program,
    attachment_program_detail: imageData.attachment_program_detail,
    source_url: imageData.source_url,
    disdelete: false,
    thumbnailSize: imageData.thumbnailSize,
    fullSize: imageData.fullSize,
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
      StartDay: formatDateForSchedule(new Date()),
      StartDayTime: "00:00:00",
      EndDay: formatDateForSchedule(new Date()),
      EndDayTime: "23:59:59",
      IsLimitWeek: 0,
      LimitWeek: [1, 1, 1, 1, 1, 1, 1],
    },
    shareWithMe: false,
    Trigger: { Type: "lightStrip", Value: "0" },
    customTags: [],
    source: "MEDIA.WEB",
    hover: true,
    fileID: imageData.fileID,
    Duration: duration,
    isShowAspectBtn: false,
    ReserveAS: 0,
    playTime: Math.floor(duration / 1000),
    PlayTimes: "1",
    inEffect: { Name: "No Effect", Type: 0, Time: 1500, webTime: 1.5 },
  };
}

function buildPlaylistPayload(playlistName, pages, width, height) {
  const programPages = pages.map((page) => ({
    AppointDuration: 3600000,
    Opacity: 1,
    LoopType: 1,
    BgColor: "0xFF000000",
    Regions: page.children.map((child) => ({
      type: 3,
      Layer: 1,
      Rect: child.Rect,
      Name: "File_Window",
      IsScheduleRegion: 0,
      Items: child.children.map((img) => ({
        Type: 2,
        Alhpa: "1.000000",
        Duration: img.Duration,
        PlayTimes: img.PlayTimes,
        inEffect: img.inEffect,
        Schedule: {
          ...img.Schedule,
          LimitWeek: "1,1,1,1,1,1,1",
        },
        Trigger: img.Trigger,
        FileSource: {
          IsRelative: 1,
          FilePath: "",
          Resource_ID: img.fileID,
          OriginName: img.name,
        },
        ReserveAS: 0,
      })),
    })),
  }));

  return {
    title: playlistName,
    Terminalgroup: [],
    program_info: {
      name: playlistName,
      displayName: playlistName,
      isCrop: 0,
      id: 10,
      type: "contents",
      version: 4,
      selectChild: 0,
      addNum: pages.length + 1,
      overStage: false,
      info: {
        Information: { Width: width, Height: height, Scale: 1 },
        Pages: [],
      },
      children: pages,
      nodeIdjia: 14,
      previewDataUrl: PLACEHOLDER_IMAGE,
      duration: 0,
    },
    Programs: {
      Program: {
        Information: { Width: width, Height: height, Scale: 1 },
        Pages: programPages,
      },
    },
    status: "publish",
  };
}

function formatDateForSchedule(date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function getContentType(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  const types = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
  };
  return types[ext] || "image/jpeg";
}

module.exports = {
  uploadImageToColorLight,
  uploadImagesToColorLight,
  createProgram,
  fetchProgram,
  updateProgram,
  buildPayloadFromExistingPages,
  extractImageData,
  getContentType,
};
