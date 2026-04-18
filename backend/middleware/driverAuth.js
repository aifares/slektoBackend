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
    if (tokenPair) return decodeURIComponent(tokenPair.split("=")[1]);
  }
  return null;
}

async function driverAuthMiddleware(req, res, next) {
  try {
    const accessToken = parseAuthToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "Missing access token" });
    }

    const { data: userResult, error: userError } =
      await supabase.auth.getUser(accessToken);
    if (userError || !userResult?.user) {
      return res.status(401).json({
        error: "Invalid access token",
        details: userError?.message,
      });
    }

    req.user = userResult.user;

    const { data: driverRow, error: driverError } = await supabase
      .from("drivers")
      .select("*")
      .eq("auth_user_id", req.user.id)
      .single();

    if (driverError || !driverRow) {
      return res.status(403).json({ error: "No driver account for this user" });
    }

    if (driverRow.status !== "approved") {
      return res.status(403).json({
        error: "Driver account not approved",
        status: driverRow.status,
      });
    }

    req.driver = driverRow;
    return next();
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Auth middleware error", details: err.message });
  }
}

module.exports = { driverAuthMiddleware };
