const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const { fetchMediaByProgramId } = require("../services/media");
const { buildCampaignPlaybackMetrics } = require("../services/campaignMetrics");

// GET /programs - Returns client's active programs with campaign metrics and thumbnails
router.get("/", async (req, res) => {
  try {
    const client = req.client; // set by auth middleware

    // 1) Resolve client's active programs (via campaigns in active window)
    const nowIso = new Date().toISOString();
    const { data: activeCampaigns, error: campaignsError } = await supabase
      .from("campaign")
      .select("program_id, status, start_at, end_at, hours_bought")
      .eq("client_id", client.id)
      .in("status", ["active", "planned"]) // consider planned in window
      .lte("start_at", nowIso)
      .gte("end_at", nowIso);

    if (campaignsError) {
      return res.status(500).json({
        error: "Failed to fetch client's campaigns",
        details: campaignsError.message,
      });
    }

    const programIds = Array.from(
      new Set((activeCampaigns || []).map((c) => c.program_id))
    );

    console.log("Active campaigns found:", activeCampaigns?.length || 0);
    console.log("Program IDs from campaigns:", programIds);

    // If no active programs, return early
    if (programIds.length === 0) {
      return res.json({
        client: { id: client.id, name: client.name, activePrograms: [] },
        programs: [],
      });
    }

    // Fetch program details for active programs
    let programDetails = [];
    const { data: programsData, error: programsError } = await supabase
      .from("programs")
      .select("id, name, download_status_time, files")
      .in("id", programIds);

    if (programsError) {
      console.warn("Failed to fetch program details:", programsError.message);
    } else {
      console.log("Programs found in database:", programsData?.length || 0);
      console.log("Program data:", programsData);
      programDetails = (programsData || []).map((program) => ({
        id: program.id,
        name: program.name,
        download_status_time: program.download_status_time,
        files: program.files,
      }));
    }

    // Enrich programs with thumbnail image (if available)
    let programDetailsWithThumb = programDetails;
    if (programIds.length > 0 && programDetails.length > 0) {
      try {
        const thumbnails = await Promise.all(
          programIds.map(async (pid) => {
            const mediaFiles = await fetchMediaByProgramId(pid);
            const thumbUrl =
              (mediaFiles && mediaFiles[0] && mediaFiles[0].thumbnail_url) ||
              null;
            return [pid, thumbUrl];
          })
        );
        const thumbByProgramId = Object.fromEntries(thumbnails);
        programDetailsWithThumb = programDetails.map((p) => ({
          ...p,
          thumbnail_url: thumbByProgramId[p.id] || null,
        }));
      } catch (thumbErr) {
        console.warn("Failed to fetch program thumbnails:", thumbErr.message);
      }
    }

    // Compute campaign playback metrics per program via service
    const playbackMetricsByProgram = await buildCampaignPlaybackMetrics(
      activeCampaigns || [],
      programIds
    );

    // Enrich programs with playback metrics if available
    const programsOut = (programDetailsWithThumb || []).map((p) => {
      const metrics = playbackMetricsByProgram[p.id] || {
        minutes_played_since_campaign_start: 0,
        campaign_completion_percent: 0,
        campaign_hours_bought: 0,
        campaign_minutes_bought: 0,
        hours_played_since_campaign_start: 0,
        campaign_start_at: null,
        campaign_end_at: null,
      };
      return { ...p, ...metrics };
    });

    const response = {
      client: { id: client.id, name: client.name, activePrograms: programIds },
      programs: programsOut,
    };

    res.json(response);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch programs data", details: err.message });
  }
});

module.exports = router;
