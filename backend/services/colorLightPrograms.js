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
      }
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
      `Failed to fetch program from ColorLight: ${error.message}`
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
      }
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

/**
 * Find pages in a program that contain specific file IDs
 * @param {Object} programData - Program data from ColorLight
 * @param {Array<number>} clientFileIds - Array of media_id values to find
 * @returns {Array<string>} Page names to delete
 */
function findPagesToDelete(programData, clientFileIds) {
  const pagesToDelete = [];

  for (const page of programData.children || []) {
    // Get files in this page's file window
    const fileWindow = page.children?.find((c) => c.type === "fileWindow");
    const filesInPage = fileWindow?.children || [];

    // Check if ANY file in this page belongs to the client
    const hasClientFile = filesInPage.some((file) =>
      clientFileIds.includes(file.fileID)
    );

    if (hasClientFile) {
      pagesToDelete.push(page.name);
      console.log(
        `   📄 Page "${
          page.name
        }" contains client file (fileID in [${clientFileIds.join(", ")}])`
      );
    }
  }

  return pagesToDelete;
}

/**
 * Transform program data for update (remove specified pages)
 * @param {Object} program - Original program data
 * @param {Array} remainingChildren - Filtered children (pages to keep)
 * @returns {Object} Transformed payload for ColorLight API
 */
function transformProgramForUpdate(program, remainingChildren) {
  // Update selectChild if needed
  let newSelectChild = program.selectChild;
  if (newSelectChild >= remainingChildren.length) {
    newSelectChild = Math.max(0, remainingChildren.length - 1);
  }

  // Create program_info with filtered children
  const programInfo = {
    ...program,
    children: remainingChildren,
    selectChild: newSelectChild,
  };

  // Transform pages to Programs.Program.Pages format
  const transformedPages = remainingChildren.map((page) => {
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

  // Build final payload
  return {
    title: program.name || program.displayName,
    Terminalgroup: [],
    program_info: programInfo,
    Programs: {
      Program: {
        Information: program.info?.Information || {
          Width: 160,
          Height: 120,
          Scale: 1,
        },
        Pages: transformedPages,
      },
    },
  };
}

/**
 * Remove a client's files from a ColorLight program
 * This is the main function to call when a campaign completes
 *
 * @param {number} programId - Program ID
 * @param {number} clientId - Client ID whose files should be removed
 * @returns {Promise<Object>} Result summary
 */
async function removeClientFilesFromProgram(programId, clientId) {
  const result = {
    success: true,
    programId,
    clientId,
    pagesRemoved: [],
    pagesRemaining: 0,
    errors: [],
  };

  try {
    console.log(
      `\n🔄 Removing client ${clientId}'s files from program ${programId}...`
    );

    // Step 1: Get client's file IDs from YOUR database
    console.log(`   📊 Fetching client's files from database...`);
    const { data: clientFiles, error: dbError } = await supabase
      .from("files")
      .select("media_id, name")
      .eq("program_id", programId)
      .eq("client_id", clientId)
      .is("removed_at", null);

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    if (!clientFiles || clientFiles.length === 0) {
      console.log(
        `   ⚠️  No active files found for client ${clientId} in program ${programId}`
      );
      result.success = true;
      return result;
    }

    const clientFileIds = clientFiles
      .map((f) => f.media_id)
      .filter((id) => id != null);

    console.log(`   📁 Found ${clientFiles.length} files to remove:`);
    clientFiles.forEach((f) =>
      console.log(`      - ${f.name} (media_id: ${f.media_id})`)
    );

    if (clientFileIds.length === 0) {
      console.log(
        `   ⚠️  No media IDs found - files may not be synced properly`
      );
      result.errors.push("No media IDs found for client files");
      return result;
    }

    // Step 2: GET - Fetch current program from ColorLight
    console.log(`   🌐 Fetching program from ColorLight API...`);
    const program = await fetchProgramFromColorLight(programId);

    const originalPageCount = program.children?.length || 0;
    console.log(`   📄 Program has ${originalPageCount} pages`);

    // Step 3: Find pages to delete (local operation)
    console.log(`   🔍 Identifying pages containing client's files...`);
    const pagesToDelete = findPagesToDelete(program, clientFileIds);

    if (pagesToDelete.length === 0) {
      console.log(`   ⚠️  No pages found containing client's files`);
      result.success = true;
      return result;
    }

    result.pagesRemoved = pagesToDelete;
    console.log(`   🗑️  Pages to remove: ${pagesToDelete.join(", ")}`);

    // Step 4: Filter out pages to delete
    const remainingPages = program.children.filter(
      (page) => !pagesToDelete.includes(page.name)
    );
    result.pagesRemaining = remainingPages.length;

    if (remainingPages.length === 0) {
      console.log(
        `   ⚠️  Warning: This would remove ALL pages from the program!`
      );
      // You might want to handle this case differently
    }

    console.log(`   ✅ Pages remaining: ${remainingPages.length}`);

    // Step 5: Transform payload for update
    console.log(`   🔧 Transforming payload for ColorLight API...`);
    const updatePayload = transformProgramForUpdate(program, remainingPages);

    // Step 6: PUT - Update program on ColorLight
    console.log(`   🚀 Updating program on ColorLight API...`);
    await updateProgramOnColorLight(programId, updatePayload);

    console.log(
      `   ✅ Successfully removed ${pagesToDelete.length} pages from program ${programId}`
    );
    result.success = true;
  } catch (error) {
    console.error(`   ❌ Error removing files from program:`, error.message);
    result.success = false;
    result.errors.push(error.message);
  }

  return result;
}

module.exports = {
  fetchProgramFromColorLight,
  updateProgramOnColorLight,
  findPagesToDelete,
  transformProgramForUpdate,
  removeClientFilesFromProgram,
};
