const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const path = require("path");

const COLORLIGHT_AUTH = "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==";
const BASE_URL = "https://us33.colorlightcloud.com";
const SESSION_COOKIE =
  "SESSION=NDRjMjFlZGEtOWI1Zi00NWFiLTg4YzQtODQ1Y2Q2ZjAyYmVl";

// Placeholder base64 image for imgDataUrl/previewDataUrl
const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Uploads an image to Colorlight Cloud
 * @param {string} imagePath - Path to the image file
 * @param {string} customFilename - Optional custom filename
 * @returns {Promise<Object>} Upload response data
 */
async function uploadImage(imagePath, customFilename = null) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  const filename = customFilename || path.basename(imagePath);
  const form = new FormData();

  form.append("file", fs.createReadStream(imagePath), {
    filename: filename,
    contentType: getContentType(filename),
  });

  const response = await axios.post(
    `${BASE_URL}/wp-json/wp/v2/media?title=${encodeURIComponent(filename)}`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: COLORLIGHT_AUTH,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        Referer: `${BASE_URL}/media`,
        Accept: "application/json, text/plain, */*",
      },
    },
  );

  console.log(`Uploaded: ${filename} (ID: ${response.data.id})`);
  return response.data;
}

/**
 * Creates a playlist from uploaded image data
 * @param {string} playlistName - Name for the playlist
 * @param {Array} images - Array of image objects from upload responses
 * @param {Object} options - Playlist options
 * @returns {Promise<Object>} Created playlist response
 */
async function createPlaylist(playlistName, images, options = {}) {
  const { width = 160, height = 120, defaultDuration = 8000 } = options;

  if (!images || images.length === 0) {
    throw new Error("At least one image is required");
  }

  const pages = images.map((image, index) => {
    const imageData = extractImageData(image);
    return buildPage(imageData, index + 2, width, height, defaultDuration);
  });

  const payload = buildPlaylistPayload(playlistName, pages, width, height);

  // Save payload to file for debugging
  const debugPath = path.join(__dirname, "playlist_payload_debug.json");
  fs.writeFileSync(debugPath, JSON.stringify(payload, null, 2));
  console.log(`\nPayload saved to: ${debugPath}`);

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

  console.log(`Created playlist: ${playlistName} (ID: ${response.data.id})`);
  return response.data;
}

/**
 * Uploads images and creates a playlist in one flow
 * @param {string} playlistName - Name for the playlist
 * @param {Array<string>} imagePaths - Array of paths to image files
 * @param {Object} options - Upload and playlist options
 * @returns {Promise<Object>} Result with uploadData and playlistData
 */
async function uploadAndCreatePlaylist(playlistName, imagePaths, options = {}) {
  console.log(`\n=== Starting Upload & Create Playlist: ${playlistName} ===\n`);

  // Validate all images exist first
  for (const imagePath of imagePaths) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }
  }

  // Upload all images
  console.log(`Uploading ${imagePaths.length} image(s)...`);
  const uploadedImages = [];
  for (const imagePath of imagePaths) {
    try {
      const uploadResult = await uploadImage(imagePath, options.customFilename);
      uploadedImages.push(uploadResult);
    } catch (error) {
      console.error(`Failed to upload ${imagePath}:`, error.message);
      throw error;
    }
  }

  // Create playlist with uploaded images
  console.log("\nCreating playlist...");
  const playlistResult = await createPlaylist(playlistName, uploadedImages, {
    width: options.width || 160,
    height: options.height || 120,
    defaultDuration: options.defaultDuration || 8000,
  });

  console.log("\n=== Complete! ===");
  console.log(`Playlist ID: ${playlistResult.id}`);
  console.log(`Playlist URL: ${playlistResult.link}`);
  console.log(`Images in playlist: ${uploadedImages.length}`);

  return {
    uploads: uploadedImages,
    playlist: playlistResult,
  };
}

/**
 * Updates an existing playlist with new images
 * @param {number} playlistId - ID of the playlist to update
 * @param {Array<string>} imagePaths - Array of paths to new image files
 * @param {Object} options - Upload and playlist options
 * @returns {Promise<Object>} Result with uploadData and updated playlist
 */
async function updatePlaylist(playlistId, imagePaths, options = {}) {
  console.log(`\n=== Updating Playlist ${playlistId} ===\n`);

  // Fetch existing playlist
  const existingPlaylist = await getPlaylist(playlistId);
  console.log(
    `Found existing playlist: ${existingPlaylist.title?.rendered || playlistId}`,
  );

  // Upload new images
  const uploadedImages = [];
  for (const imagePath of imagePaths) {
    const uploadResult = await uploadImage(imagePath, options.customFilename);
    uploadedImages.push(uploadResult);
  }

  // Get existing images if keeping them
  let allImages = uploadedImages;
  if (
    options.keepExisting !== false &&
    existingPlaylist.program_info?.children
  ) {
    const existingImages = extractImagesFromPlaylist(existingPlaylist);
    allImages = [...existingImages, ...uploadedImages];
  }

  // Rebuild playlist with all images
  const width =
    options.width ||
    existingPlaylist.program_info?.info?.Information?.Width ||
    160;
  const height =
    options.height ||
    existingPlaylist.program_info?.info?.Information?.Height ||
    120;

  const pages = allImages.map((image, index) => {
    const imageData = extractImageData(image);
    return buildPage(
      imageData,
      index + 2,
      width,
      height,
      options.defaultDuration || 8000,
    );
  });

  const payload = buildPlaylistPayload(
    existingPlaylist.title?.rendered || `Playlist${playlistId}`,
    pages,
    width,
    height,
  );

  // Update the playlist
  const response = await axios.put(
    `${BASE_URL}/wp-json/wp/v2/programs/${playlistId}`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: COLORLIGHT_AUTH,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "sec-ch-ua":
          '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        Cookie: SESSION_COOKIE,
      },
    },
  );

  console.log(`\nUpdated playlist: ${response.data.id}`);
  return {
    newUploads: uploadedImages,
    playlist: response.data,
  };
}

/**
 * Fetches an existing playlist
 * @param {number} playlistId - Playlist ID
 * @returns {Promise<Object>} Playlist data
 */
async function getPlaylist(playlistId) {
  const response = await axios.get(
    `${BASE_URL}/wp-json/wp/v2/programs/${playlistId}`,
    {
      headers: {
        Authorization: COLORLIGHT_AUTH,
        Accept: "application/json, text/plain, */*",
      },
    },
  );
  return response.data;
}

/**
 * Extracts image data from existing playlist children
 */
function extractImagesFromPlaylist(playlist) {
  const images = [];
  const children = playlist.program_info?.children || [];

  for (const page of children) {
    for (const child of page.children || []) {
      if (child.children) {
        images.push(...child.children);
      }
    }
  }

  return images;
}

// Helper functions (extractImageData, buildPage, buildImageChild, buildPlaylistPayload, formatDateForSchedule, getContentType)

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
          LimitWeek: "1,1,1,1,1,1,1", // String format for Programs.Pages
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
  const ext = path.extname(filename).toLowerCase();
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
  };
  return types[ext] || "image/jpeg";
}

// === EXAMPLE USAGE ===

async function main() {
  // Create new playlist with two images
  const imagePaths = [
    path.join(__dirname, "testImage.jpg"),
    path.join(__dirname, "testimage2.jpg"),
  ];

  try {
    const result = await uploadAndCreatePlaylist("test5", imagePaths, {
      width: 160,
      height: 120,
      defaultDuration: 8000,
    });

    console.log("\nFinal Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response?.data) {
      console.error(
        "Response data:",
        JSON.stringify(error.response.data, null, 2),
      );
    }
    process.exit(1);
  }
}

// Export all functions for use as module
module.exports = {
  uploadImage,
  createPlaylist,
  uploadAndCreatePlaylist,
  updatePlaylist,
  getPlaylist,
};

// Run if called directly
if (require.main === module) {
  main();
}
