const { supabase } = require("../config/supabase");

/**
 * Fetch the playlists belonging to a campaign.
 *
 * Post-migration 028, every campaign has at least one row in
 * campaign_playlists (rotation-mode campaigns have exactly one).
 * This helper is the single read path; callers should not query
 * campaign.program_id / bags_bought / hours_bought directly.
 *
 * @param {number} campaignId
 * @returns {Promise<Array<{id:number, campaign_id:number, program_id:number,
 *   label:string|null, bags_assigned:number, hours_bought:number,
 *   completed_at:string|null, created_at:string}>>}
 */
async function getCampaignPlaylists(campaignId) {
  const { data, error } = await supabase
    .from("campaign_playlists")
    .select(
      "id, campaign_id, program_id, label, bags_assigned, hours_bought, completed_at, created_at"
    )
    .eq("campaign_id", campaignId)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch campaign_playlists for campaign ${campaignId}: ${error.message}`
    );
  }

  return data || [];
}

/**
 * Fetch playlists for many campaigns in a single query.
 * Returns a map keyed by campaign_id.
 *
 * @param {Array<number>} campaignIds
 * @returns {Promise<Record<number, Array>>}
 */
async function getPlaylistsByCampaignIds(campaignIds) {
  if (!campaignIds || campaignIds.length === 0) return {};

  const { data, error } = await supabase
    .from("campaign_playlists")
    .select(
      "id, campaign_id, program_id, label, bags_assigned, hours_bought, completed_at, created_at"
    )
    .in("campaign_id", campaignIds)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch campaign_playlists: ${error.message}`
    );
  }

  const byCampaign = {};
  for (const row of data || []) {
    if (!byCampaign[row.campaign_id]) byCampaign[row.campaign_id] = [];
    byCampaign[row.campaign_id].push(row);
  }
  return byCampaign;
}

/**
 * Recompute the rollup columns (program_id, hours_bought, bags_bought)
 * on the campaign row from its children. Keeps legacy readers correct.
 *
 * @param {number} campaignId
 */
async function recomputeCampaignRollups(campaignId) {
  const playlists = await getCampaignPlaylists(campaignId);
  if (playlists.length === 0) return;

  const totalBags = playlists.reduce(
    (sum, p) => sum + (p.bags_assigned || 0),
    0
  );
  const totalHours = playlists.reduce(
    (sum, p) => sum + Number(p.hours_bought || 0),
    0
  );

  const { error } = await supabase
    .from("campaign")
    .update({
      program_id: playlists[0].program_id,
      bags_bought: totalBags,
      hours_bought: totalHours,
    })
    .eq("id", campaignId);

  if (error) {
    throw new Error(
      `Failed to update campaign ${campaignId} rollups: ${error.message}`
    );
  }
}

/**
 * Normalize incoming campaign payload into a common internal shape.
 *
 *   { mode, playlists: [{ label, bags, hours, files: [{ buffer, filename, mimetype }] }] }
 *
 * Accepts either:
 *   - Rotation (legacy): flat `hours_bought`, `bags_bought`, `images[]`
 *   - Split: `mode="split"`, `playlists` JSON array + `images[]` consumed in order
 *
 * Throws on validation errors (route handlers convert to 400).
 *
 * @param {Object} body - parsed request body
 * @param {Array}  files - multer file array
 */
function parseCampaignPayload(body, files) {
  const mode = (body.mode || "rotation").toLowerCase();

  if (mode !== "rotation" && mode !== "split") {
    throw new Error(`Invalid mode '${mode}'. Must be 'rotation' or 'split'.`);
  }

  if (!files || files.length === 0) {
    throw new Error("At least one image is required");
  }

  const toFile = (f) => ({
    buffer: f.buffer,
    filename: f.originalname,
    mimetype: f.mimetype,
  });

  if (mode === "rotation") {
    const hours = Number(body.hours_bought);
    const bags = parseInt(body.bags_bought, 10);
    if (!hours || hours <= 0) {
      throw new Error("hours_bought must be a positive number");
    }
    if (!bags || bags <= 0) {
      throw new Error("bags_bought must be a positive integer");
    }
    return {
      mode,
      playlists: [
        {
          label: null,
          bags,
          hours,
          files: files.map(toFile),
        },
      ],
    };
  }

  // split mode
  let playlistsMeta;
  try {
    playlistsMeta = JSON.parse(body.playlists || "[]");
  } catch (err) {
    throw new Error(`'playlists' must be a valid JSON array: ${err.message}`);
  }
  if (!Array.isArray(playlistsMeta) || playlistsMeta.length < 2) {
    throw new Error("split mode requires 'playlists' with at least 2 entries");
  }

  let imageCursor = 0;
  const playlists = playlistsMeta.map((p, i) => {
    const bags = parseInt(p.bags, 10);
    const hours = Number(p.hours);
    const imageCount = parseInt(p.image_count, 10);
    if (!bags || bags <= 0) {
      throw new Error(`playlists[${i}].bags must be a positive integer`);
    }
    if (!hours || hours <= 0) {
      throw new Error(`playlists[${i}].hours must be a positive number`);
    }
    if (!imageCount || imageCount <= 0) {
      throw new Error(`playlists[${i}].image_count must be a positive integer`);
    }
    const slice = files.slice(imageCursor, imageCursor + imageCount);
    if (slice.length !== imageCount) {
      throw new Error(
        `playlists[${i}]: expected ${imageCount} images but only ${slice.length} remain`
      );
    }
    imageCursor += imageCount;
    return {
      label: p.label ? String(p.label).trim() : null,
      bags,
      hours,
      files: slice.map(toFile),
    };
  });

  if (imageCursor !== files.length) {
    throw new Error(
      `Image count mismatch: ${files.length} files uploaded, ${imageCursor} accounted for`
    );
  }

  return { mode, playlists };
}

module.exports = {
  getCampaignPlaylists,
  getPlaylistsByCampaignIds,
  recomputeCampaignRollups,
  parseCampaignPayload,
};
