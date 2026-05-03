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

function getVerifyService() {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!serviceSid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID must be set");
  }
  return getTwilioClient().verify.v2.services(serviceSid);
}

function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/**
 * Send an SMS to a single phone number (general-purpose messaging).
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
 * Trigger a Twilio Verify code SMS to the given phone.
 * Returns the Verify resource (status is typically "pending").
 */
async function sendVerification(phone, channel = "sms") {
  return getVerifyService().verifications.create({
    to: toE164(phone),
    channel,
  });
}

/**
 * Check a Twilio Verify code for the given phone.
 * Returns { approved: boolean, status: string, raw }.
 * `approved` is true only when Twilio returns status === "approved" && valid === true.
 */
async function checkVerification(phone, code) {
  try {
    const result = await getVerifyService().verificationChecks.create({
      to: toE164(phone),
      code,
    });
    return {
      approved: result.status === "approved" && result.valid === true,
      status: result.status,
      raw: result,
    };
  } catch (err) {
    // Twilio returns 404 when the verification has expired or was already consumed.
    if (err?.status === 404) {
      return { approved: false, status: "expired", raw: null };
    }
    throw err;
  }
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

module.exports = {
  sendSMS,
  sendVerification,
  checkVerification,
  broadcastToDrivers,
  toE164,
};
