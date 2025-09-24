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

async function authMiddleware(req, res, next) {
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

    req.user = userResult.user;

    // Resolve client by user_id
    const { data: clientRow, error: clientError } = await supabase
      .from("client")
      .select("*")
      .eq("user_id", req.user.id)
      .single();

    if (clientError || !clientRow) {
      return res.status(403).json({ error: "No client account for this user" });
    }

    req.client = clientRow;
    return next();
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Auth middleware error", details: err.message });
  }
}

module.exports = { authMiddleware };
