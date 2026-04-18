const { supabase } = require("../config/supabase");

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  }
  // Lazy-require so server starts without twilio installed during dev if desired
  const twilio = require("twilio");
  return twilio(accountSid, authToken);
}

function toE164(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/**
 * Send an SMS to a single phone number.
 */
async function sendSMS(phone, message) {
  const client = getTwilioClient();
  return client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toE164(phone),
  });
}

/**
 * Broadcast an SMS to a list of driver IDs (or all approved drivers if none specified).
 * Returns { sent: number, failed: number, errors: [] }
 */
async function broadcastToDrivers(message, driverIds = null) {
  let query = supabase
    .from("drivers")
    .select("id, phone, name")
    .eq("status", "approved")
    .not("phone", "is", null);

  if (driverIds && driverIds.length > 0) {
    query = query.in("id", driverIds);
  }

  const { data: drivers, error } = await query;
  if (error) throw new Error(`Failed to fetch drivers: ${error.message}`);

  const results = await Promise.allSettled(
    (drivers || []).map((d) => sendSMS(d.phone, message))
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const errors = results
    .filter((r) => r.status === "rejected")
    .map((r, i) => ({ driver_id: drivers[i]?.id, error: r.reason?.message }));

  console.log(`📢 Broadcast: ${sent}/${drivers.length} messages sent`);
  return { sent, failed: errors.length, total: drivers.length, errors };
}

module.exports = { sendSMS, broadcastToDrivers };
