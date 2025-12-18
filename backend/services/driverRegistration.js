const { supabase } = require("../config/supabase");

/**
 * Register a new driver with their application details
 * @param {Object} data - Driver registration data
 * @returns {Object} - Result with success/error and driver data
 */
async function registerDriver(data) {
  const {
    fullName,
    email,
    phone,
    address,
    city,
    state,
    dateOfBirth,
    driversLicense,
    dailyHours,
    weeklyHours,
    submissionDate,
    submissionTime,
    ipAddress,
    termsAccepted,
    termsAcceptedAt,
  } = data;

  // Validate required fields
  if (!fullName) {
    return {
      success: false,
      status: 400,
      error: "Missing required field: fullName",
    };
  }

  if (!termsAccepted) {
    return {
      success: false,
      status: 400,
      error: "Terms must be accepted to register",
    };
  }

  // Check if driver with this email already exists
  if (email) {
    const { data: existingDriver, error: checkError } = await supabase
      .from("drivers")
      .select("id, email, status")
      .eq("email", email)
      .single();

    if (existingDriver) {
      return {
        success: false,
        status: 409,
        error: "Driver with this email already exists",
        driverId: existingDriver.id,
        driverStatus: existingDriver.status,
      };
    }
  }

  // Insert new driver
  const { data: insertedData, error } = await supabase
    .from("drivers")
    .insert([
      {
        name: fullName,
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        date_of_birth: dateOfBirth || null,
        license_number: driversLicense || null,
        daily_hours: dailyHours ? parseFloat(dailyHours) : null,
        weekly_hours: weeklyHours ? parseFloat(weeklyHours) : null,
        submission_date: submissionDate || null,
        submission_time: submissionTime || null,
        ip_address: ipAddress || null,
        terms_accepted: termsAccepted,
        terms_accepted_at: termsAcceptedAt || new Date().toISOString(),
        status: "pending",
      },
    ])
    .select();

  if (error) {
    console.error("❌ Error inserting driver:", error);
    return {
      success: false,
      status: 500,
      error: "Failed to register driver",
      details: error.message,
    };
  }

  console.log(
    `✅ Driver registered successfully: ${fullName} (ID: ${insertedData[0].id})`
  );

  return {
    success: true,
    status: 201,
    message: "Driver registration submitted successfully",
    driver: {
      id: insertedData[0].id,
      name: insertedData[0].name,
      email: insertedData[0].email,
      status: insertedData[0].status,
      createdAt: insertedData[0].created_at,
    },
  };
}

module.exports = { registerDriver };
