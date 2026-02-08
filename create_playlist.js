const axios = require("axios");

const COLORLIGHT_AUTH = "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==";
const BASE_URL = "https://us33.colorlightcloud.com";

/**
 * Creates a playlist from uploaded image data
 * @param {string} playlistName - Name for the playlist
 * @param {Array} images - Array of image objects from upload responses
 * @param {Object} options - Playlist options
 * @param {number} options.width - Screen width (default: 160)
 * @param {number} options.height - Screen height (default: 120)
 * @param {number} options.defaultDuration - Default display time in ms (default: 8000)
 * @returns {Promise<Object>} Created playlist response
 */
async function createPlaylist(playlistName, images, options = {}) {
  const {
    width = 160,
    height = 120,
    defaultDuration = 8000,
  } = options;

  if (!images || images.length === 0) {
    throw new Error("At least one image is required");
  }

  // Build pages from images (one page per image)
  const pages = images.map((image, index) => {
    const imageData = extractImageData(image);
    return buildPage(imageData, index + 2, width, height, defaultDuration);
  });

  // Build the full playlist payload
  const payload = buildPlaylistPayload(playlistName, pages, width, height);

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
        },
      }
    );

    console.log("Playlist created successfully!");
    console.log("Playlist ID:", response.data.id);
    console.log("Playlist URL:", response.data.link);
    return response.data;
  } catch (error) {
    console.error("Failed to create playlist:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Extracts standardized image data from upload response
 * Handles different response formats from Colorlight API
 */
function extractImageData(uploadResponse) {
  // Handle different response formats
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
      width: data.media_details?.sizes?.thumbnail?.width || data.thumbnailSize?.width || 200,
      height: data.media_details?.sizes?.thumbnail?.height || data.thumbnailSize?.height || 200,
    },
    file_type: data.file_type || data.mime_type?.split("/")[1] || "jpg",
    format_size: data.format_size || "0 KB",
    author: data.author?.toString() || "AliFares",
    date_gmt: data.date_gmt || data.modified_gmt || new Date().toISOString(),
    modified_gmt: data.modified_gmt || data.date_gmt || new Date().toISOString(),
    attachment_program: data.attachment_program || [],
    attachment_program_detail: data.attachment_program_detail || [],
  };
}

/**
 * Builds a single page configuration for an image
 */
function buildPage(imageData, pageIndex, width, height, duration) {
  const pageId = 10 + pageIndex; // Start IDs from 13
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
        badge: "0",
        icon: "perm_media",
        pagesTextShot: true,
      },
    ],
    imgDataUrl: null,
    ifShowPageConfig: false,
  };
}

/**
 * Builds the image child object for the page
 */
function buildImageChild(imageData, duration) {
  const uniqueId = Math.random();

  return {
    id: uniqueId,
    file_type: imageData.file_type,
    author: imageData.author,
    date: imageData.date_gmt?.replace("T", " ").substring(0, 19) || new Date().toISOString().replace("T", " ").substring(0, 19),
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
    disdelete: true,
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

/**
 * Builds the full playlist payload
 */
function buildPlaylistPayload(playlistName, pages, width, height) {
  // Build Programs XML structure
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
        Schedule: img.Schedule,
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
      selectChild: 1,
      addNum: pages.length,
      overStage: false,
      info: {
        Information: { Width: width, Height: height, Scale: 1 },
        Pages: [],
      },
      children: pages,
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

/**
 * Formats date for schedule (YYYY/M/D format)
 */
function formatDateForSchedule(date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Example usage
 */
async function main() {
  // Example: Using upload response data
  // In practice, you would get this from your upload_image.js response
  const uploadedImages = [
    {
      id: 2747715,
      name: "testImage.jpg",
      source_url: "https://us33.colorlightcloud.com:443/wp-content/Tus/uploads/.../testImage.jpg",
      src: "https://us33.colorlightcloud.com:443/wp-content/upload/.../testImage-200x200.jpg",
      fullSize: { width: 404, height: 316 },
      thumbnailSize: { width: 200, height: 156 },
      file_type: "jpg",
      format_size: "18.4 KB",
      date_gmt: "2026-01-31T18:23:23Z",
      modified_gmt: "2026-01-31T18:23:23Z",
    },
    // Add more images as needed
  ];

  try {
    const playlist = await createPlaylist("MyPlaylist", uploadedImages, {
      width: 160,
      height: 120,
      defaultDuration: 8000, // 8 seconds per image
    });
    console.log("Success:", playlist);
  } catch (error) {
    console.error("Error:", error);
  }
}

// Export for use as module
module.exports = { createPlaylist, extractImageData, buildPlaylistPayload };

// Run if called directly
if (require.main === module) {
  main();
}
