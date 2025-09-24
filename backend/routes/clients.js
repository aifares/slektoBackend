const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");

function parseAuthToken(req) {
  const authHeader =
    req.headers["authorization"] || req.headers["Authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const cookieHeader = req.headers["cookie"];
  if (cookieHeader) {
    const parts = cookieHeader.split(";").map((p) => p.trim());
    const tokenPair = parts.find((p) => p.startsWith("sb-access-token="));
    if (tokenPair) {
      return decodeURIComponent(tokenPair.split("=")[1]);
    }
  }
  return null;
}

// Create or update a client row on first authenticated visit
router.post("/signup", async (req, res) => {
  try {
    const accessToken = parseAuthToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "Missing Supabase access token" });
    }

    const { data: userResult, error: userError } = await supabase.auth.getUser(
      accessToken
    );
    if (userError || !userResult?.user) {
      return res.status(401).json({
        error: "Invalid Supabase access token",
        details: userError?.message,
      });
    }

    const user = userResult.user;
    const email =
      user.email || (user.identities?.[0]?.identity_data?.email ?? null);
    const emailConfirmed = !!user.email_confirmed_at || !!user.confirmed_at;

    // Upsert into client table by user_id (or email as secondary unique)
    const upsertPayload = {
      name:
        req.body?.name ||
        (email ? email.split("@")[0] : `user_${user.id.substring(0, 8)}`),
      user_id: user.id,
      email,
      email_verified: emailConfirmed,
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Try upsert by user_id
    let { data: clientRow, error: upsertError } = await supabase
      .from("client")
      .upsert(upsertPayload, { onConflict: "user_id" })
      .select("*")
      .single();

    if (upsertError) {
      return res.status(500).json({
        error: "Failed to create/update client",
        details: upsertError.message,
      });
    }

    return res.status(200).json({
      message: "Client ensured",
      client: clientRow,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Unexpected error", details: err.message });
  }
});

// Connect a client to a campaign
router.post("/:clientId/campaigns", async (req, res) => {
  try {
    const { clientId } = req.params;
    const {
      program_id,
      hours_bought,
      start_at,
      end_at,
      status = "active",
    } = req.body;

    // Validate required fields
    if (!program_id || !hours_bought || !start_at || !end_at) {
      return res.status(400).json({
        error: "Missing required fields",
        details: "program_id, hours_bought, start_at, and end_at are required",
        example: {
          program_id: 2460739,
          hours_bought: 168.0,
          start_at: "2025-01-20T00:00:00Z",
          end_at: "2025-01-27T23:59:59Z",
          status: "active",
        },
      });
    }

    // Validate client exists
    const { data: clientData, error: clientError } = await supabase
      .from("client")
      .select("id, name")
      .eq("id", clientId)
      .single();

    if (clientError || !clientData) {
      return res.status(404).json({
        error: "Client not found",
        details: `No client found with ID ${clientId}`,
      });
    }

    // Validate program exists
    const { data: programData, error: programError } = await supabase
      .from("programs")
      .select("id, name")
      .eq("id", program_id)
      .single();

    if (programError || !programData) {
      return res.status(404).json({
        error: "Program not found",
        details: `No program found with ID ${program_id}`,
      });
    }

    // Validate date range
    const startDate = new Date(start_at);
    const endDate = new Date(end_at);

    if (startDate >= endDate) {
      return res.status(400).json({
        error: "Invalid date range",
        details: "start_at must be before end_at",
      });
    }

    // Validate hours_bought
    if (hours_bought < 0) {
      return res.status(400).json({
        error: "Invalid hours_bought",
        details: "hours_bought must be greater than or equal to 0",
      });
    }

    // Validate status
    const validStatuses = [
      "planned",
      "active",
      "paused",
      "completed",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        details: `Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Create campaign
    const campaignData = {
      client_id: parseInt(clientId),
      program_id: parseInt(program_id),
      hours_bought: parseFloat(hours_bought),
      start_at: start_at,
      end_at: end_at,
      status: status,
    };

    const { data: campaignResult, error: campaignError } = await supabase
      .from("campaign")
      .insert(campaignData)
      .select("*")
      .single();

    if (campaignError) {
      return res.status(500).json({
        error: "Failed to create campaign",
        details: campaignError.message,
      });
    }

    res.status(201).json({
      message: "Campaign created successfully",
      campaign: campaignResult,
      client: clientData,
      program: programData,
    });
  } catch (err) {
    res.status(500).json({
      error: "Unexpected error",
      details: err.message,
    });
  }
});

// Get all campaigns for a client
router.get("/:clientId/campaigns", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { status, program_id } = req.query;

    // Validate client exists
    const { data: clientData, error: clientError } = await supabase
      .from("client")
      .select("id, name")
      .eq("id", clientId)
      .single();

    if (clientError || !clientData) {
      return res.status(404).json({
        error: "Client not found",
        details: `No client found with ID ${clientId}`,
      });
    }

    // Build query
    let query = supabase
      .from("campaign")
      .select(
        `
        *,
        programs:program_id (
          id,
          name
        )
      `
      )
      .eq("client_id", clientId);

    // Add filters
    if (status) {
      query = query.eq("status", status);
    }
    if (program_id) {
      query = query.eq("program_id", program_id);
    }

    const { data: campaigns, error: campaignsError } = await query;

    if (campaignsError) {
      return res.status(500).json({
        error: "Failed to fetch campaigns",
        details: campaignsError.message,
      });
    }

    res.json({
      client: clientData,
      campaigns: campaigns || [],
      count: campaigns?.length || 0,
    });
  } catch (err) {
    res.status(500).json({
      error: "Unexpected error",
      details: err.message,
    });
  }
});

// Update a campaign
router.put("/:clientId/campaigns/:campaignId", async (req, res) => {
  try {
    const { clientId, campaignId } = req.params;
    const { program_id, hours_bought, start_at, end_at, status } = req.body;

    // Validate client exists
    const { data: clientData, error: clientError } = await supabase
      .from("client")
      .select("id, name")
      .eq("id", clientId)
      .single();

    if (clientError || !clientData) {
      return res.status(404).json({
        error: "Client not found",
        details: `No client found with ID ${clientId}`,
      });
    }

    // Validate campaign exists and belongs to client
    const { data: campaignData, error: campaignError } = await supabase
      .from("campaign")
      .select("*")
      .eq("id", campaignId)
      .eq("client_id", clientId)
      .single();

    if (campaignError || !campaignData) {
      return res.status(404).json({
        error: "Campaign not found",
        details: `No campaign found with ID ${campaignId} for client ${clientId}`,
      });
    }

    // Build update data
    const updateData = {};
    if (program_id !== undefined) updateData.program_id = parseInt(program_id);
    if (hours_bought !== undefined)
      updateData.hours_bought = parseFloat(hours_bought);
    if (start_at !== undefined) updateData.start_at = start_at;
    if (end_at !== undefined) updateData.end_at = end_at;
    if (status !== undefined) updateData.status = status;

    // Validate date range if both dates are provided
    if (start_at && end_at) {
      const startDate = new Date(start_at);
      const endDate = new Date(end_at);

      if (startDate >= endDate) {
        return res.status(400).json({
          error: "Invalid date range",
          details: "start_at must be before end_at",
        });
      }
    }

    // Validate hours_bought if provided
    if (hours_bought !== undefined && hours_bought < 0) {
      return res.status(400).json({
        error: "Invalid hours_bought",
        details: "hours_bought must be greater than or equal to 0",
      });
    }

    // Validate status if provided
    if (status !== undefined) {
      const validStatuses = [
        "planned",
        "active",
        "paused",
        "completed",
        "cancelled",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: "Invalid status",
          details: `Status must be one of: ${validStatuses.join(", ")}`,
        });
      }
    }

    // Update campaign
    const { data: updatedCampaign, error: updateError } = await supabase
      .from("campaign")
      .update(updateData)
      .eq("id", campaignId)
      .eq("client_id", clientId)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({
        error: "Failed to update campaign",
        details: updateError.message,
      });
    }

    res.json({
      message: "Campaign updated successfully",
      campaign: updatedCampaign,
    });
  } catch (err) {
    res.status(500).json({
      error: "Unexpected error",
      details: err.message,
    });
  }
});

// Delete a campaign
router.delete("/:clientId/campaigns/:campaignId", async (req, res) => {
  try {
    const { clientId, campaignId } = req.params;

    // Validate client exists
    const { data: clientData, error: clientError } = await supabase
      .from("client")
      .select("id, name")
      .eq("id", clientId)
      .single();

    if (clientError || !clientData) {
      return res.status(404).json({
        error: "Client not found",
        details: `No client found with ID ${clientId}`,
      });
    }

    // Validate campaign exists and belongs to client
    const { data: campaignData, error: campaignError } = await supabase
      .from("campaign")
      .select("*")
      .eq("id", campaignId)
      .eq("client_id", clientId)
      .single();

    if (campaignError || !campaignData) {
      return res.status(404).json({
        error: "Campaign not found",
        details: `No campaign found with ID ${campaignId} for client ${clientId}`,
      });
    }

    // Delete campaign
    const { error: deleteError } = await supabase
      .from("campaign")
      .delete()
      .eq("id", campaignId)
      .eq("client_id", clientId);

    if (deleteError) {
      return res.status(500).json({
        error: "Failed to delete campaign",
        details: deleteError.message,
      });
    }

    res.json({
      message: "Campaign deleted successfully",
      campaign: campaignData,
    });
  } catch (err) {
    res.status(500).json({
      error: "Unexpected error",
      details: err.message,
    });
  }
});

module.exports = router;
