const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const { fetchMediaByProgramId, fetchMediaUrlsByProgramAndClient } = require("../services/media");
const { buildGpsHeatmapData } = require("../services/heatmap");
const { buildCampaignPlaybackMetrics } = require("../services/campaignMetrics");
const { fetchHistoricalTerminals } = require("../services/historicalTerminals");

// moved to services/heatmap.js

/**
 * Groups upcoming planned campaigns by start_at+end_at window (to merge split playlists),
 * fetches all media URLs across all programs in each group, and returns a unified event shape.
 */
async function buildUpcomingEvents(rawCampaigns, clientId) {
  if (!rawCampaigns || rawCampaigns.length === 0) return [];

  // Group campaigns that share the same start+end window (split playlists)
  const groups = {};
  for (const c of rawCampaigns) {
    const key = `${c.start_at}|${c.end_at}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  return Promise.all(
    Object.values(groups).map(async (group) => {
      const primary = group[0];
      const allProgramIds = group.map((g) => g.program_id);

      // Fetch media from all programs in the group in parallel
      const allMedia = await Promise.all(
        allProgramIds.map((pid) => fetchMediaUrlsByProgramAndClient(pid, clientId))
      );
      const mediaUrls = [...new Set(allMedia.flat())];

      // Strip playlist-specific label from name to get a clean campaign name
      const baseName = (primary.programs?.name || null)?.replace(/\s*[-\[].*(Image|Playlist|label).*$/i, "").trim() || primary.programs?.name || null;

      return {
        id: primary.programs?.id || primary.program_id,
        name: baseName,
        thumbnail_url: primary.programs?.thumbnail_url || null,
        modified: primary.programs?.modified || null,
        created: primary.programs?.created || null,
        status: primary.programs?.status || null,
        media_urls: mediaUrls,
        program_ids: allProgramIds,
        isActive: false,
        campaign_start_at: primary.start_at,
        campaign_end_at: primary.end_at,
        campaign_hours_bought: Number(primary.hours_bought || 0),
        campaign_minutes_bought: Math.floor(Number(primary.hours_bought || 0) * 60),
        campaign_completion_percent: 0,
        minutes_played_since_campaign_start: 0,
        hours_played_since_campaign_start: 0,
        campaign_completed_at: null,
        share_of_voice_percent: null,
        mode: primary.mode,
      };
    })
  );
}

// GET /clientData - Aggregated client data: active programs, terminals playing them, latest GPS per terminal, and GPS heat map data
router.get("/", async (req, res) => {
  try {
    const client = req.client; // set by auth middleware

    // Parse query parameters for GPS heat map
    const {
      includeHeatmap = "true",
      gpsStartDate,
      gpsEndDate,
      gpsProgramId,
      gpsDays = "1",
    } = req.query;

    // Set default date range for GPS data
    // Default to past 7 days including today when no startDate is provided
    let endDate = gpsEndDate || new Date().toISOString();
    let startDate = gpsStartDate;

    // 1) Resolve client's active programs (via campaigns)
    // A campaign is active if: status="active" AND completed_at IS NULL
    // Show campaigns with status="planned" that are in the current date window
    const nowIso = new Date().toISOString();

    // Fetch all active campaigns (status="active" AND not completed)
    const { data: activeStatusCampaigns, error: activeError } = await supabase
      .from("campaign")
      .select(
        "program_id, status, start_at, end_at, hours_bought, client_id, completed_at"
      )
      .eq("client_id", client.id)
      .eq("status", "active")
      .is("completed_at", null);

    // Fetch planned campaigns that are in the current date window
    const { data: plannedCampaigns, error: plannedError } = await supabase
      .from("campaign")
      .select(
        "program_id, status, start_at, end_at, hours_bought, client_id, completed_at"
      )
      .eq("client_id", client.id)
      .eq("status", "planned")
      .lte("start_at", nowIso)
      .gte("end_at", nowIso);

    // Combine both results
    const campaignsError = activeError || plannedError;
    const activeCampaigns = [
      ...(activeStatusCampaigns || []),
      ...(plannedCampaigns || []),
    ];

    if (campaignsError) {
      return res.status(500).json({
        error: "Failed to fetch client's campaigns",
        details: campaignsError.message,
      });
    }

    // Compute isActive per campaign: status="active" AND completed_at IS NULL
    const campaignsWithActiveStatus = (activeCampaigns || []).map((c) => {
      const isActive = c.status === "active" && c.completed_at === null;
      return { ...c, isActive };
    });

    const programIds = Array.from(
      new Set(campaignsWithActiveStatus.map((c) => c.program_id))
    );

    console.log(
      "Active campaigns found:",
      campaignsWithActiveStatus?.length || 0
    );
    console.log("Program IDs from campaigns:", programIds);

    // Calculate default start date: past 7 days including today
    if (!startDate) {
      // Default to gpsDays (7 days) ago, including today
      const defaultStartDate = new Date(
        Date.now() - (parseInt(gpsDays) - 1) * 24 * 60 * 60 * 1000
      );
      // Set to start of day to include full day
      defaultStartDate.setUTCHours(0, 0, 0, 0);
      startDate = defaultStartDate.toISOString();
      console.log(
        "Using default GPS days for heatmap:",
        gpsDays,
        "days (including today)"
      );

      // If there are active campaigns, use the earlier of: campaign start date or default 7 days
      if (campaignsWithActiveStatus && campaignsWithActiveStatus.length > 0) {
        // Only use campaigns that are currently active (isActive = true)
        const activeCampaignsOnly = campaignsWithActiveStatus.filter(
          (c) => c.isActive === true
        );

        if (activeCampaignsOnly.length > 0) {
          const startDates = activeCampaignsOnly.map(
            (c) => new Date(c.start_at)
          );
          const earliestStart = new Date(Math.min(...startDates));
          // Always use campaign start date if it exists (even if it's today or recent)
          // This ensures we only show GPS points from campaign start onwards
          startDate = earliestStart.toISOString();
          console.log(
            "Using campaign start date:",
            startDate,
            "(from",
            activeCampaignsOnly.length,
            "active campaigns)"
          );
        }
      }
    }

    // Fetch program details for active programs
    let programDetails = [];
    const programDetailsById = {}; // Map to track which programs we found

    if (programIds.length > 0) {
      const { data: programsData, error: programsError } = await supabase
        .from("programs")
        .select("id, name, thumbnail_url, modified, created, status")
        .in("id", programIds);

      if (programsError) {
        console.warn("Failed to fetch program details:", programsError.message);
      } else {
        console.log("Programs found in database:", programsData?.length || 0);
        console.log("Program data:", programsData);
        programDetails = (programsData || []).map((program) => {
          programDetailsById[program.id] = program;
          return {
            id: program.id,
            name: program.name,
            thumbnail_url: program.thumbnail_url,
            modified: program.modified,
            created: program.created,
            status: program.status,
          };
        });
      }
    }

    // For any program IDs that don't have details from the programs table,
    // try to get program name from playing records or create a basic entry
    const missingProgramIds = programIds.filter(
      (pid) => !programDetailsById[pid]
    );
    if (missingProgramIds.length > 0) {
      console.log(
        "Programs not found in programs table, fetching names from playing records:",
        missingProgramIds
      );

      // Try to get program names from playing records
      const { data: playingRecords, error: playingError } = await supabase
        .from("playing")
        .select("program_id, program_name")
        .in("program_id", missingProgramIds)
        .limit(1000);

      if (!playingError && playingRecords) {
        // Create a map of program_id -> program_name from playing records
        const programNameMap = {};
        playingRecords.forEach((record) => {
          if (
            record.program_id &&
            record.program_name &&
            !programNameMap[record.program_id]
          ) {
            programNameMap[record.program_id] = record.program_name;
          }
        });

        // Create program entries for missing programs
        missingProgramIds.forEach((pid) => {
          const programName = programNameMap[pid] || `Program ${pid}`;
          programDetails.push({
            id: pid,
            name: programName,
            thumbnail_url: null,
            modified: null,
            created: null,
            status: null,
          });
          console.log(
            `Created program entry from playing records: ${pid} - ${programName}`
          );
        });
      } else {
        // If we can't get names from playing records, create basic entries
        missingProgramIds.forEach((pid) => {
          programDetails.push({
            id: pid,
            name: `Program ${pid}`,
            thumbnail_url: null,
            modified: null,
            created: null,
            status: null,
          });
          console.log(`Created basic program entry: ${pid}`);
        });
      }
    }

    // Enrich programs with thumbnail image (if available)
    let programDetailsWithThumb = programDetails;
    if (programIds.length > 0 && programDetails.length > 0) {
      try {
        const thumbnails = await Promise.all(
          programIds.map(async (pid) => {
            try {
              const mediaFiles = await fetchMediaByProgramId(pid);
              const thumbUrl =
                (mediaFiles && mediaFiles[0] && mediaFiles[0].thumbnail_url) ||
                null;
              return [pid, thumbUrl];
            } catch (err) {
              console.warn(
                `Failed to fetch thumbnail for program ${pid}:`,
                err.message
              );
              return [pid, null];
            }
          })
        );
        const thumbByProgramId = Object.fromEntries(thumbnails);
        programDetailsWithThumb = programDetails.map((p) => ({
          ...p,
          thumbnail_url: thumbByProgramId[p.id] || p.thumbnail_url || null,
        }));
      } catch (thumbErr) {
        console.warn("Failed to fetch program thumbnails:", thumbErr.message);
      }
    }

    if (programIds.length === 0) {
      const { data: upcomingCampaignsData } = await supabase
        .from("campaign")
        .select("program_id, start_at, end_at, hours_bought, mode, status, programs(id, name, thumbnail_url, modified, created, status)")
        .eq("client_id", client.id)
        .eq("status", "planned")
        .gt("start_at", new Date().toISOString())
        .order("start_at", { ascending: true });

      const upcomingEventsForClient = await buildUpcomingEvents(upcomingCampaignsData, client.id);

      return res.json({
        client: { id: client.id, name: client.name, activePrograms: [] },
        programs: [],
        terminals: [],
        upcoming_events: upcomingEventsForClient,
        summary: {
          total_terminals: 0,
          terminals_playing: 0,
          terminals_offline: 0,
        },
        heatmap: {
          summary: {
            totalGpsPoints: 0,
            programsCount: 0,
            terminalsCount: 0,
            distanceMiles: 0,
            dateRange: `${startDate} to ${endDate}`,
          },
          programs: [],
        },
        historical_terminals: [],
      });
    }

    // 2) Fetch currently playing sessions for those programs
    const { data: playingRows, error: playingError } = await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, file_name, source, started_at, status"
      )
      .in("program_id", programIds)
      .eq("status", "current");

    if (playingError) {
      return res.status(500).json({
        error: "Failed to fetch currently playing data",
        details: playingError.message,
      });
    }

    // Get terminal IDs from currently playing terminals only
    const terminalIds = Array.from(
      new Set((playingRows || []).map((p) => p.terminal_id))
    );

    // Fetch ALL playing sessions for campaign metrics (not just current)
    const { data: allPlayingSessions } = await supabase
      .from("playing")
      .select("terminal_id, program_id, started_at, ended_at, status")
      .in("program_id", programIds);

    // Get all terminal IDs that have ever played these programs
    const allTerminalIds = Array.from(
      new Set((allPlayingSessions || []).map((s) => s.terminal_id))
    );

    // Compute campaign playback metrics per program via service
    const playbackMetricsByProgram = await buildCampaignPlaybackMetrics(
      campaignsWithActiveStatus || [],
      programIds,
      allTerminalIds.length > 0 ? allTerminalIds : null,
      client.id // Pass client_id for Share of Voice
    );

    // Attach isActive to metrics for each program
    for (const [pid, metrics] of Object.entries(playbackMetricsByProgram)) {
      const campaign = campaignsWithActiveStatus.find(
        (c) => c.program_id === parseInt(pid)
      );
      if (campaign) metrics.isActive = campaign.isActive;
    }

    if (terminalIds.length === 0) {
      // Even if no terminals are currently playing, we still want to show heatmap data
      // for all terminals that have historically played these programs
      let heatmapData = null;
      let allHistoricalTerminals = [];

      try {
        const { data: allTerminalsForPrograms, error: allTerminalsError } =
          await supabase
            .from("playing")
            .select("terminal_id")
            .in("program_id", programIds);

        // Get unique terminal IDs from the results
        const allTerminalIds = [
          ...new Set((allTerminalsForPrograms || []).map((t) => t.terminal_id)),
        ];

        if (allTerminalIds.length > 0) {
          // Build campaign programs array with campaign start dates
          const campaignPrograms = campaignsWithActiveStatus
            .filter((c) => c.isActive) // Only active campaigns
            .map((c) => ({
              program_id: c.program_id,
              campaign_start_at: c.start_at,
            }));

          heatmapData = await buildGpsHeatmapData(
            client.id,
            programIds,
            allTerminalIds,
            startDate,
            endDate,
            gpsProgramId,
            campaignPrograms.length > 0 ? campaignPrograms : null
          );
        }

        // Also get historical terminals data for the early return
        const { data: historicalTerminalsData, error: historicalError } =
          await supabase
            .from("playing")
            .select(
              "terminal_id, program_id, program_name, started_at, ended_at, status"
            )
            .in("program_id", programIds);

        if (!historicalError && historicalTerminalsData) {
          // Group by terminal_id and get unique terminals with their program info
          const terminalMap = new Map();
          historicalTerminalsData.forEach((record) => {
            if (!terminalMap.has(record.terminal_id)) {
              terminalMap.set(record.terminal_id, {
                terminal_id: record.terminal_id,
                programs_played: [],
                first_played_at: record.started_at,
                last_played_at: record.ended_at || record.started_at,
              });
            }

            const terminal = terminalMap.get(record.terminal_id);

            // Add program if not already in list
            if (
              !terminal.programs_played.find(
                (p) => p.program_id === record.program_id
              )
            ) {
              terminal.programs_played.push({
                program_id: record.program_id,
                program_name: record.program_name,
              });
            }

            // Update time ranges
            if (
              new Date(record.started_at) < new Date(terminal.first_played_at)
            ) {
              terminal.first_played_at = record.started_at;
            }
            if (
              record.ended_at &&
              new Date(record.ended_at) > new Date(terminal.last_played_at)
            ) {
              terminal.last_played_at = record.ended_at;
            }
          });

          allHistoricalTerminals = Array.from(terminalMap.values());
        }
      } catch (heatmapError) {
        console.warn(
          "Failed to build historical heatmap data:",
          heatmapError.message
        );
      }

      // No terminals are currently playing, so return empty terminals array

      // Enrich programs with playback metrics if available
      // Ensure all programs from active campaigns have metrics, even if no playback data exists
      const programsOut = (programDetailsWithThumb || []).map((p) => {
        let metrics = playbackMetricsByProgram[p.id];

        // If no metrics exist, try to get campaign info from activeCampaigns
        if (!metrics) {
          const campaign = campaignsWithActiveStatus.find(
            (c) => c.program_id === p.id
          );
          if (campaign) {
            // Create default metrics with campaign info
            const totalHoursBought = Number(campaign.hours_bought || 0);
            const totalAllowedMinutes = Math.max(
              0,
              Math.floor(totalHoursBought * 60)
            );
            metrics = {
              minutes_played_since_campaign_start: 0,
              campaign_completion_percent: 0,
              campaign_hours_bought: totalHoursBought,
              campaign_minutes_bought: totalAllowedMinutes,
              hours_played_since_campaign_start: 0,
              campaign_start_at: campaign.start_at,
              campaign_end_at: campaign.end_at,
              campaign_completed_at: campaign.completed_at || null,
              isActive: campaign.isActive || false,
              share_of_voice_percent: null,
              media_urls: [],
            };
          } else {
            // Fallback to zero metrics if no campaign found
            metrics = {
              minutes_played_since_campaign_start: 0,
              campaign_completion_percent: 0,
              campaign_hours_bought: 0,
              campaign_minutes_bought: 0,
              hours_played_since_campaign_start: 0,
              campaign_start_at: null,
              campaign_end_at: null,
              isActive: false,
            };
          }
        } else {
          // Metrics exist, ensure isActive is set
          if (metrics.isActive === undefined) {
            const campaign = campaignsWithActiveStatus.find(
              (c) => c.program_id === p.id
            );
            metrics.isActive = campaign?.isActive || false;
          }
        }

        return { ...p, ...metrics };
      });

      const { data: upcomingCampaignsEarly } = await supabase
        .from("campaign")
        .select("program_id, start_at, end_at, hours_bought, mode, status, programs(id, name, thumbnail_url, modified, created, status)")
        .eq("client_id", client.id)
        .eq("status", "planned")
        .gt("start_at", new Date().toISOString())
        .order("start_at", { ascending: true });

      const upcomingEventsEarly = await buildUpcomingEvents(upcomingCampaignsEarly, client.id);

      return res.json({
        client: {
          id: client.id,
          name: client.name,
          activePrograms: programIds,
        },
        programs: programsOut,
        terminals: [],
        upcoming_events: upcomingEventsEarly,
        summary: {
          total_terminals: 0,
          terminals_playing: 0,
          terminals_offline: 0,
          historical_terminals_count: allHistoricalTerminals.length,
        },
        heatmap: heatmapData || {
          summary: {
            totalGpsPoints: 0,
            programsCount: 0,
            terminalsCount: 0,
            distanceMiles: 0,
            dateRange: `${startDate} to ${endDate}`,
          },
          programs: [],
        },
        historical_terminals: allHistoricalTerminals,
      });
    }

    // 3) Fetch terminal metadata
    const { data: terminalRows, error: terminalsError } = await supabase
      .from("terminals")
      .select("terminalid, name, group_name, last_report_time, power_status")
      .in("terminalid", terminalIds);

    // 3.5) Fetch terminal online status from terminal_status_log
    const { data: terminalStatusRows, error: statusError } = await supabase
      .from("terminal_status_log")
      .select("terminal_id, status, status_changed_at")
      .in("terminal_id", terminalIds)
      .order("status_changed_at", { ascending: false });

    // Create a map of latest status for each terminal
    const latestStatusByTerminal = {};
    if (!statusError && terminalStatusRows) {
      for (const statusRow of terminalStatusRows) {
        if (!latestStatusByTerminal[statusRow.terminal_id]) {
          latestStatusByTerminal[statusRow.terminal_id] = statusRow.status;
        }
      }
    }

    if (terminalsError) {
      return res.status(500).json({
        error: "Failed to fetch terminal metadata",
        details: terminalsError.message,
      });
    }

    // 4) For live GPS, get the most recent GPS per terminal from terminal_gps_data
    // Supabase does not support DISTINCT ON; fetch latest by ordering and reducing client-side
    const { data: gpsRows, error: gpsError } = await supabase
      .from("terminal_gps_data")
      .select("terminal_id, longitude, latitude, inserted_at")
      .in("terminal_id", terminalIds)
      .order("terminal_id", { ascending: true })
      .order("inserted_at", { ascending: false });

    if (gpsError) {
      return res.status(500).json({
        error: "Failed to fetch GPS data",
        details: gpsError.message,
      });
    }

    const latestGpsByTerminal = {};
    for (const row of gpsRows || []) {
      if (!latestGpsByTerminal[row.terminal_id]) {
        latestGpsByTerminal[row.terminal_id] = row;
      }
    }

    // Index helpers
    const terminalMetaById = Object.fromEntries(
      (terminalRows || []).map((t) => [t.terminalid, t])
    );

    // Build output terminals list - include ALL terminals, not just currently playing ones
    const playingByTerminalId = Object.fromEntries(
      (playingRows || []).map((p) => [p.terminal_id, p])
    );

    const terminalsOut = (terminalRows || []).map((terminal) => {
      const playing = playingByTerminalId[terminal.terminalid] || null;
      const gps = latestGpsByTerminal[terminal.terminalid] || null;
      const isOnline = latestStatusByTerminal[terminal.terminalid] === "online";

      return {
        terminalId: terminal.terminalid,
        name: terminal.name || null,
        group_name: terminal.group_name || null,
        last_report_time: terminal.last_report_time || null,
        power_status: terminal.power_status || null,
        isOnline: isOnline,
        playing: playing
          ? {
              program_id: playing.program_id,
              program_name: playing.program_name,
              file_name: playing.file_name,
              source: playing.source,
              started_at: playing.started_at,
            }
          : null,
        gps: gps
          ? {
              longitude: gps.longitude,
              latitude: gps.latitude,
              last_updated: gps.inserted_at,
            }
          : null,
      };
    });

    const terminalsPlayingCount = (playingRows || []).length;
    const offlineCount = (terminalRows || []).filter(
      (t) => t.power_status === "off"
    ).length;

    // 5) GPS Heat Map Data (always included)
    let heatmapData = null;
    try {
      // Get all terminals that have ever played these programs (not just currently online)
      const { data: allTerminalsForPrograms, error: allTerminalsError } =
        await supabase
          .from("playing")
          .select("terminal_id")
          .in("program_id", programIds);

      // Get unique terminal IDs from the results
      const allTerminalIds = [
        ...new Set((allTerminalsForPrograms || []).map((t) => t.terminal_id)),
      ];
      console.log(
        "All terminals that ever played these programs:",
        allTerminalIds
      );

      // Build campaign programs array with campaign start dates
      const campaignPrograms = campaignsWithActiveStatus
        .filter((c) => c.isActive) // Only active campaigns
        .map((c) => ({
          program_id: c.program_id,
          campaign_start_at: c.start_at,
        }));

      heatmapData = await buildGpsHeatmapData(
        client.id,
        programIds,
        allTerminalIds.length > 0 ? allTerminalIds : terminalIds, // Use all historical terminals if available
        startDate,
        endDate,
        gpsProgramId,
        campaignPrograms.length > 0 ? campaignPrograms : null
      );
    } catch (heatmapError) {
      console.warn("Failed to build GPS heat map data:", heatmapError.message);
      // Don't fail the entire request if heatmap fails
    }

    // Get all terminals that have played these programs for the response
    let allHistoricalTerminals = [];
    try {
      allHistoricalTerminals = await fetchHistoricalTerminals(programIds);
    } catch (error) {
      console.warn("Failed to fetch historical terminals data:", error.message);
    }

    // Enrich programs with playback metrics if available
    // Ensure all programs from active campaigns have metrics, even if no playback data exists
    const programsOut = (programDetailsWithThumb || []).map((p) => {
      let metrics = playbackMetricsByProgram[p.id];

      // If no metrics exist, try to get campaign info from activeCampaigns
      if (!metrics) {
        const campaign = campaignsWithActiveStatus.find(
          (c) => c.program_id === p.id
        );
        if (campaign) {
          // Create default metrics with campaign info
          const totalHoursBought = Number(campaign.hours_bought || 0);
          const totalAllowedMinutes = Math.max(
            0,
            Math.floor(totalHoursBought * 60)
          );
          metrics = {
            minutes_played_since_campaign_start: 0,
            campaign_completion_percent: 0,
            campaign_hours_bought: totalHoursBought,
            campaign_minutes_bought: totalAllowedMinutes,
            hours_played_since_campaign_start: 0,
            campaign_start_at: campaign.start_at,
            campaign_end_at: campaign.end_at,
            campaign_completed_at: campaign.completed_at || null,
            isActive: campaign.isActive || false,
            share_of_voice_percent: null,
            media_urls: [],
          };
        } else {
          // Fallback to zero metrics if no campaign found
          metrics = {
            minutes_played_since_campaign_start: 0,
            campaign_completion_percent: 0,
            campaign_hours_bought: 0,
            campaign_minutes_bought: 0,
            hours_played_since_campaign_start: 0,
            campaign_start_at: null,
            campaign_end_at: null,
            isActive: false,
          };
        }
      } else {
        // Metrics exist, ensure isActive is set
        if (metrics.isActive === undefined) {
          const campaign = campaignsWithActiveStatus.find(
            (c) => c.program_id === p.id
          );
          metrics.isActive = campaign?.isActive || false;
        }
      }

      return { ...p, ...metrics };
    });

    // 6) Upcoming events (future planned campaigns for this client)
    let upcomingEvents = [];
    try {
      const { data: upcomingCampaigns } = await supabase
        .from("campaign")
        .select("program_id, start_at, end_at, hours_bought, mode, status, programs(id, name, thumbnail_url, modified, created, status)")
        .eq("client_id", client.id)
        .eq("status", "planned")
        .gt("start_at", new Date().toISOString())
        .order("start_at", { ascending: true });
      upcomingEvents = await buildUpcomingEvents(upcomingCampaigns, client.id);
    } catch (eventsErr) {
      console.warn("Failed to fetch upcoming events:", eventsErr.message);
    }

    const response = {
      client: { id: client.id, name: client.name, activePrograms: programIds },
      programs: programsOut,
      terminals: terminalsOut,
      historical_terminals: allHistoricalTerminals,
      upcoming_events: upcomingEvents,
      summary: {
        total_terminals: terminalsOut.length,
        terminals_playing: terminalsPlayingCount,
        terminals_offline: offlineCount,
        historical_terminals_count: allHistoricalTerminals.length,
      },
      heatmap: heatmapData || {
        summary: {
          totalGpsPoints: 0,
          programsCount: 0,
          terminalsCount: 0,
          distanceMiles: 0,
          dateRange: `${startDate} to ${endDate}`,
        },
        programs: [],
      },
    };

    res.json(response);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to build client data", details: err.message });
  }
});

module.exports = router;
