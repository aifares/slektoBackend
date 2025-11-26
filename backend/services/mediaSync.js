const axios = require("axios");
const { supabase } = require("../config/supabase");
const { PROGRAMS_AUTH_HEADER } = require("../utils");

/**
 * Media Sync Service
 *
 * Syncs media metadata from ColorLight's /wp-json/wp/v2/media endpoint
 * to enrich files table with client_id, source_url, title, and other metadata.
 *
 * Correlation: Matches files by filename (name field)
 * Client ID Extraction: Parses from customTags (format: CompanyName_ClientID)
 */

const COLORLIGHT_MEDIA_URL =
  "https://us33.colorlightcloud.com/wp-json/wp/v2/media";
const PER_PAGE = 100; // Fetch 100 items per page
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Parse client_id from custom tags array
 * Expected format: ["Lava_1", "Featured"] -> client_id = 1
 * Supports: "CompanyName_123", "CLIENT_5", "Acme_42", etc.
 *
 * @param {Array<string>} customTags - Array of tags from ColorLight
 * @returns {number|null} - Extracted client_id or null
 */
function parseClientIdFromTags(customTags) {
  if (!customTags || !Array.isArray(customTags) || customTags.length === 0) {
    return null;
  }

  for (const tag of customTags) {
    // Try to extract number after underscore: "Lava_1" -> "1"
    const match = tag.match(/_(\d+)$/);
    if (match && match[1]) {
      const clientId = parseInt(match[1], 10);
      if (!isNaN(clientId)) {
        console.log(`✅ Extracted client_id ${clientId} from tag "${tag}"`);
        return clientId;
      }
    }
  }

  console.warn(`⚠️ No client_id found in tags: ${JSON.stringify(customTags)}`);
  return null;
}

/**
 * Fetch a single page of media from ColorLight
 *
 * @param {number} page - Page number (1-indexed)
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<Array>} - Array of media items
 */
async function fetchMediaPage(page, retryCount = 0) {
  try {
    console.log(`📡 Fetching media page ${page}...`);

    const response = await axios.get(COLORLIGHT_MEDIA_URL, {
      ...PROGRAMS_AUTH_HEADER,
      params: {
        page,
        per_page: PER_PAGE,
        flag: "filter",
      },
      timeout: 30000, // 30 second timeout
    });

    console.log(`✅ Fetched ${response.data.length} items from page ${page}`);
    return response.data;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.warn(
        `⚠️ Failed to fetch page ${page} (attempt ${
          retryCount + 1
        }/${MAX_RETRIES}):`,
        error.message
      );
      console.log(`⏳ Retrying in ${RETRY_DELAY_MS}ms...`);

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return fetchMediaPage(page, retryCount + 1);
    }

    console.error(
      `❌ Failed to fetch page ${page} after ${MAX_RETRIES} retries:`,
      error.message
    );
    throw error;
  }
}

/**
 * Fetch all media from ColorLight with pagination
 * Continues until a page returns less than PER_PAGE items
 *
 * @returns {Promise<Array>} - Array of all media items
 */
async function fetchAllMedia() {
  const allMedia = [];
  let page = 1;
  let hasMore = true;

  console.log(`🚀 Starting media fetch (${PER_PAGE} items per page)...`);

  while (hasMore) {
    try {
      const mediaPage = await fetchMediaPage(page);

      if (mediaPage.length === 0) {
        console.log(`✅ No more media found at page ${page}`);
        hasMore = false;
        break;
      }

      allMedia.push(...mediaPage);

      // If we got less than PER_PAGE items, this is the last page
      if (mediaPage.length < PER_PAGE) {
        console.log(
          `✅ Last page reached (${mediaPage.length} items < ${PER_PAGE})`
        );
        hasMore = false;
      } else {
        page++;
      }
    } catch (error) {
      console.error(
        `❌ Error during pagination at page ${page}:`,
        error.message
      );
      // Stop pagination on error
      hasMore = false;
    }
  }

  console.log(
    `✅ Fetched ${allMedia.length} total media items from ${page} pages`
  );
  return allMedia;
}

/**
 * Extract title from custom tags (everything before _clientID)
 * Format: Title_ClientID → returns "Title"
 * This is the ONLY source of title - ColorLight's title field is ignored
 *
 * @param {Array<string>} customTags - Array of tags from ColorLight
 * @returns {string|null} - Extracted title or null
 */
function extractTitleFromTags(customTags) {
  if (!customTags || !Array.isArray(customTags) || customTags.length === 0) {
    console.warn(`⚠️ No custom tags found - title will be null`);
    return null;
  }

  for (const tag of customTags) {
    // Look for format: Title_ClientID
    const match = tag.match(/^(.+)_(\d+)$/);
    if (match && match[1]) {
      const title = match[1];
      console.log(`✅ Extracted title "${title}" from tag "${tag}"`);
      return title;
    }
  }

  console.warn(
    `⚠️ No valid title_clientID format found in tags: ${JSON.stringify(
      customTags
    )}`
  );
  return null;
}

/**
 * Transform ColorLight media item to files table format
 *
 * IMPORTANT: Title comes ONLY from custom tags (format: Title_ClientID)
 * ColorLight's title field is ignored completely
 *
 * @param {Object} mediaItem - Media item from ColorLight API
 * @returns {Object} - Transformed file record
 */
function transformMediaToFile(mediaItem) {
  // Extract client_id and title from custom tags ONLY
  const clientId = parseClientIdFromTags(mediaItem.customTags);
  const title = extractTitleFromTags(mediaItem.customTags);

  // Build full filename with extension
  const fileName =
    mediaItem.name + (mediaItem.file_type ? `.${mediaItem.file_type}` : "");

  // Title comes ONLY from tags - no fallback to ColorLight's title field
  return {
    name: fileName,
    media_id: mediaItem.id,
    client_id: clientId,
    source_url: mediaItem.source_url,
    title: title, // ONLY from tags, can be null if tag format is incorrect
    custom_tags: mediaItem.customTags || [],
    mime_type: mediaItem.mime_type || null,
    file_size_bytes: mediaItem.attachment_filesize || null,
    media_width:
      mediaItem.fullSize?.width || mediaItem.media_details?.width || null,
    media_height:
      mediaItem.fullSize?.height || mediaItem.media_details?.height || null,
    last_synced_at: new Date().toISOString(),
  };
}

/**
 * Upsert a batch of files into the database
 * Uses filename (name) as the correlation key
 *
 * @param {Array<Object>} files - Array of file records
 * @returns {Promise<Object>} - Result with counts
 */
async function upsertFilesMetadata(files) {
  if (!files || files.length === 0) {
    return { inserted: 0, updated: 0, failed: 0 };
  }

  console.log(`💾 Upserting ${files.length} file records...`);

  try {
    // Get existing files by name to determine which to update vs insert
    const fileNames = files.map((f) => f.name);
    const { data: existingFiles, error: fetchError } = await supabase
      .from("files")
      .select("id, name")
      .in("name", fileNames);

    if (fetchError) {
      console.error(`❌ Error fetching existing files:`, fetchError.message);
      return {
        inserted: 0,
        updated: 0,
        failed: files.length,
        error: fetchError.message,
      };
    }

    const existingFileMap = {};
    (existingFiles || []).forEach((f) => {
      existingFileMap[f.name] = f.id;
    });

    // Validate client_ids - get existing clients
    const uniqueClientIds = [
      ...new Set(files.map((f) => f.client_id).filter((id) => id !== null)),
    ];
    let validClientIds = new Set();

    if (uniqueClientIds.length > 0) {
      const { data: existingClients } = await supabase
        .from("client")
        .select("id")
        .in("id", uniqueClientIds);

      validClientIds = new Set((existingClients || []).map((c) => c.id));
      console.log(
        `✅ Valid client_ids: ${Array.from(validClientIds).join(", ")}`
      );
    }

    // NEW FLOW: Media sync INSERTS files, poller UPDATES with program_id
    const toUpdate = [];
    const toInsert = [];

    files.forEach((file) => {
      // Validate client_id - set to null if invalid
      const clientId =
        file.client_id && validClientIds.has(file.client_id)
          ? file.client_id
          : null;

      if (file.client_id && !clientId) {
        console.warn(
          `⚠️ Invalid client_id ${file.client_id} for file ${file.name}, setting to null`
        );
      }

      if (existingFileMap[file.name]) {
        // Existing file - update metadata only (don't touch program_id)
        toUpdate.push({
          id: existingFileMap[file.name],
          media_id: file.media_id,
          client_id: clientId,
          source_url: file.source_url,
          title: file.title,
          custom_tags: file.custom_tags,
          mime_type: file.mime_type,
          file_size_bytes: file.file_size_bytes,
          media_width: file.media_width,
          media_height: file.media_height,
          last_synced_at: file.last_synced_at,
        });
      } else {
        // New file - insert with metadata (program_id will be added by poller)
        toInsert.push({
          name: file.name,
          media_id: file.media_id,
          client_id: clientId,
          source_url: file.source_url,
          title: file.title,
          custom_tags: file.custom_tags,
          mime_type: file.mime_type,
          file_size_bytes: file.file_size_bytes,
          media_width: file.media_width,
          media_height: file.media_height,
          type: file.name?.split(".").pop() || "unknown",
          last_synced_at: file.last_synced_at,
        });
      }
    });

    console.log(
      `📊 To Update: ${toUpdate.length}, To Insert: ${toInsert.length}`
    );

    let updateCount = 0;
    let insertCount = 0;
    let failCount = 0;

    // Handle updates
    if (toUpdate.length > 0) {
      for (const file of toUpdate) {
        const { error: updateError } = await supabase
          .from("files")
          .update(file)
          .eq("id", file.id);

        if (updateError) {
          console.warn(
            `⚠️ Error updating file (id: ${file.id}):`,
            updateError.message
          );
          failCount++;
        } else {
          updateCount++;
        }
      }
    }

    // Handle inserts
    if (toInsert.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from("files")
        .insert(toInsert)
        .select();

      if (insertError) {
        console.error(`❌ Error inserting files:`, insertError.message);
        failCount += toInsert.length;
      } else {
        insertCount = inserted?.length || 0;
        console.log(
          `✅ Inserted ${insertCount} new files (program_id will be added by poller)`
        );
      }
    }

    console.log(
      `✅ Updated: ${updateCount}, Inserted: ${insertCount}, Failed: ${failCount}`
    );
    return { inserted: insertCount, updated: updateCount, failed: failCount };
  } catch (error) {
    console.error(`❌ Upsert exception:`, error.message);
    return {
      inserted: 0,
      updated: 0,
      failed: files.length,
      error: error.message,
    };
  }
}

/**
 * Main sync function - fetches all media from ColorLight and enriches files table
 *
 * @returns {Promise<Object>} - Sync statistics and results
 */
async function syncMediaFromColorLight() {
  const startTime = Date.now();
  console.log(`\n🔄 ===== MEDIA SYNC STARTED =====`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);

  const results = {
    success: false,
    started_at: new Date().toISOString(),
    completed_at: null,
    duration_ms: 0,
    total_fetched: 0,
    total_processed: 0,
    files_with_client_id: 0,
    files_without_client_id: 0,
    upsert_results: {
      inserted: 0,
      updated: 0,
      failed: 0,
    },
    deleted_orphaned: 0,
    kept_in_programs: 0,
    pages_processed: 0,
    errors: [],
  };

  try {
    // Step 1: Fetch all media from ColorLight
    const allMedia = await fetchAllMedia();
    results.total_fetched = allMedia.length;
    results.pages_processed = Math.ceil(allMedia.length / PER_PAGE);

    if (allMedia.length === 0) {
      console.log(`⚠️ No media found in ColorLight`);
      results.success = true;
      results.completed_at = new Date().toISOString();
      results.duration_ms = Date.now() - startTime;
      return results;
    }

    // Step 2: Transform to files format
    console.log(`🔄 Transforming ${allMedia.length} media items...`);
    const transformedFiles = allMedia.map(transformMediaToFile);
    results.total_processed = transformedFiles.length;

    // Count files with/without client_id
    results.files_with_client_id = transformedFiles.filter(
      (f) => f.client_id !== null
    ).length;
    results.files_without_client_id = transformedFiles.filter(
      (f) => f.client_id === null
    ).length;

    console.log(`📊 Files with client_id: ${results.files_with_client_id}`);
    console.log(
      `⚠️ Files without client_id: ${results.files_without_client_id}`
    );

    // Step 3: Deduplicate files by name (ColorLight sometimes returns duplicates)
    const filesByName = {};
    transformedFiles.forEach((file) => {
      if (!filesByName[file.name] || file.client_id) {
        // Keep first occurrence, or replace with one that has client_id
        filesByName[file.name] = file;
      }
    });

    const deduplicatedFiles = Object.values(filesByName);
    const duplicatesRemoved =
      transformedFiles.length - deduplicatedFiles.length;

    if (duplicatesRemoved > 0) {
      console.log(`🔧 Removed ${duplicatesRemoved} duplicate filename(s)`);
    }

    // Step 4: Upsert in batches (PostgreSQL can handle large batches, but let's be safe)
    const BATCH_SIZE = 100;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalFailed = 0;

    for (let i = 0; i < deduplicatedFiles.length; i += BATCH_SIZE) {
      const batch = deduplicatedFiles.slice(i, i + BATCH_SIZE);
      console.log(
        `💾 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          deduplicatedFiles.length / BATCH_SIZE
        )} (${batch.length} files)`
      );

      const batchResult = await upsertFilesMetadata(batch);
      totalInserted += batchResult.inserted;
      totalUpdated += batchResult.updated;
      totalFailed += batchResult.failed;

      if (batchResult.error) {
        results.errors.push(batchResult.error);
      }
    }

    results.upsert_results = {
      inserted: totalInserted,
      updated: totalUpdated,
      failed: totalFailed,
    };

    // Step 5: Identify and handle files that are no longer in ColorLight
    console.log(`\n🔍 Checking for files no longer in ColorLight...`);
    const syncedFileNames = new Set(deduplicatedFiles.map((f) => f.name));
    const syncedMediaIds = new Set(
      deduplicatedFiles
        .map((f) => f.media_id)
        .filter((id) => id !== null && id !== undefined)
    );

    // Find files that were previously synced but are not in current sync
    // Only consider files that have been synced before (have last_synced_at)
    const { data: filesToCheck, error: checkError } = await supabase
      .from("files")
      .select("id, name, media_id, program_id, removed_at")
      .not("last_synced_at", "is", null);

    if (checkError) {
      console.warn(`⚠️ Error checking for deleted files:`, checkError.message);
      results.errors.push(
        `Failed to check deleted files: ${checkError.message}`
      );
    } else {
      const filesToDelete = (filesToCheck || []).filter((file) => {
        // File is no longer in ColorLight if:
        // 1. It's not in the synced file names, AND
        // 2. It's not in the synced media IDs (if it has a media_id)
        const notInNames = !syncedFileNames.has(file.name);
        const notInMediaIds = file.media_id
          ? !syncedMediaIds.has(file.media_id)
          : true;

        // Only delete if both conditions are true
        return notInNames && notInMediaIds;
      });

      if (filesToDelete.length > 0) {
        console.log(
          `🗑️  Found ${filesToDelete.length} files no longer in ColorLight`
        );

        // For files with program_id, we should NOT delete them (they might still be in use)
        // Instead, we'll only delete files that have no program_id (orphaned files)
        const orphanedFiles = filesToDelete.filter(
          (f) => f.program_id === null
        );
        const filesInPrograms = filesToDelete.filter(
          (f) => f.program_id !== null
        );

        if (orphanedFiles.length > 0) {
          console.log(
            `   - ${orphanedFiles.length} orphaned files (no program_id) - will be deleted`
          );
          const orphanedIds = orphanedFiles.map((f) => f.id);

          const { error: deleteError } = await supabase
            .from("files")
            .delete()
            .in("id", orphanedIds);

          if (deleteError) {
            console.error(
              `❌ Error deleting orphaned files:`,
              deleteError.message
            );
            results.errors.push(
              `Failed to delete orphaned files: ${deleteError.message}`
            );
          } else {
            console.log(`✅ Deleted ${orphanedFiles.length} orphaned files`);
            results.deleted_orphaned = orphanedFiles.length;
          }
        }

        if (filesInPrograms.length > 0) {
          console.log(
            `   - ${filesInPrograms.length} files still in programs - keeping (may be removed from ColorLight but still in use)`
          );
          results.kept_in_programs = filesInPrograms.length;
        }
      } else {
        console.log(`✅ All previously synced files are still in ColorLight`);
        results.deleted_orphaned = 0;
        results.kept_in_programs = 0;
      }
    }

    results.success = totalFailed === 0;
    results.completed_at = new Date().toISOString();
    results.duration_ms = Date.now() - startTime;

    console.log(`\n✅ ===== MEDIA SYNC COMPLETED =====`);
    console.log(`⏰ Completed at: ${results.completed_at}`);
    console.log(
      `⏱️ Duration: ${results.duration_ms}ms (${(
        results.duration_ms / 1000
      ).toFixed(2)}s)`
    );
    console.log(`📊 Total fetched: ${results.total_fetched}`);
    console.log(`📊 Total processed: ${results.total_processed}`);
    console.log(`✅ Files with client_id: ${results.files_with_client_id}`);
    console.log(
      `⚠️ Files without client_id: ${results.files_without_client_id}`
    );
    console.log(
      `💾 Upserted: ${totalInserted} inserted, ${totalUpdated} updated, ${totalFailed} failed`
    );
    if (results.deleted_orphaned !== undefined) {
      console.log(`🗑️  Deleted: ${results.deleted_orphaned} orphaned files`);
    }
    if (
      results.kept_in_programs !== undefined &&
      results.kept_in_programs > 0
    ) {
      console.log(
        `📌 Kept: ${results.kept_in_programs} files still in programs`
      );
    }

    return results;
  } catch (error) {
    console.error(`❌ ===== MEDIA SYNC FAILED =====`);
    console.error(`❌ Error:`, error.message);
    console.error(`Stack:`, error.stack);

    results.success = false;
    results.completed_at = new Date().toISOString();
    results.duration_ms = Date.now() - startTime;
    results.errors.push(error.message);

    return results;
  }
}

module.exports = {
  syncMediaFromColorLight,
  parseClientIdFromTags,
  extractTitleFromTags,
  fetchAllMedia,
  transformMediaToFile,
  upsertFilesMetadata,
};
