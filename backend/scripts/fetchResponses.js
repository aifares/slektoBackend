const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { supabase } = require("../config/supabase");

async function fetchResponses() {
  try {
    console.log("🔑 Getting authentication token...");

    // Try to sign in to get a token
    let token;
    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: "test@clientcorp.com",
          password: "testpassword123",
        });

      if (authError) {
        console.log("⚠️ Test user doesn't exist, trying to create...");
        // Try to sign up first
        const { data: signUpData, error: signUpError } =
          await supabase.auth.signUp({
            email: "test@clientcorp.com",
            password: "testpassword123",
            options: {
              data: {
                user_id: "00000000-0000-0000-0000-000000000001",
              },
            },
          });

        if (signUpError) {
          console.error("❌ Could not create test user:", signUpError.message);
          console.log(
            "\n💡 Please run: node backend/scripts/generateTestToken.js"
          );
          console.log(
            "   Then use that token manually or set SUPABASE_TOKEN env var"
          );
          process.exit(1);
        }

        // Sign in after signup
        const { data: signInData, error: signInError } =
          await supabase.auth.signInWithPassword({
            email: "test@clientcorp.com",
            password: "testpassword123",
          });

        if (signInError) {
          console.error("❌ Could not sign in:", signInError.message);
          process.exit(1);
        }

        token = signInData.session.access_token;
      } else {
        token = authData.session.access_token;
      }
    } catch (error) {
      // Check if token is provided via environment variable
      if (process.env.SUPABASE_TOKEN) {
        token = process.env.SUPABASE_TOKEN;
        console.log("✅ Using token from SUPABASE_TOKEN environment variable");
      } else {
        console.error("❌ Could not get authentication token:", error.message);
        console.log("\n💡 Options:");
        console.log("   1. Run: node backend/scripts/generateTestToken.js");
        console.log("   2. Set SUPABASE_TOKEN environment variable");
        process.exit(1);
      }
    }

    const baseUrl = process.env.API_URL || "http://localhost:3000";
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Fetch clientData response
    console.log("\n📡 Fetching clientData from server...");
    const clientDataUrl = `${baseUrl}/clientData`;
    console.log(`   URL: ${clientDataUrl}`);

    const clientDataResponse = await axios.get(clientDataUrl, { headers });

    console.log("✅ Successfully fetched clientData!");
    console.log(`   Status: ${clientDataResponse.status}`);

    // Save clientData to JSON file
    const clientDataOutputPath = path.join(
      __dirname,
      "../../clientData_response.json"
    );
    const clientDataJson = JSON.stringify(clientDataResponse.data, null, 2);
    fs.writeFileSync(clientDataOutputPath, clientDataJson, "utf8");

    console.log(`\n💾 Saved clientData response to: ${clientDataOutputPath}`);
    console.log(`\n📊 ClientData response summary:`);
    console.log(
      `   - Client: ${clientDataResponse.data.client?.name || "N/A"} (ID: ${
        clientDataResponse.data.client?.id || "N/A"
      })`
    );
    console.log(
      `   - Active Programs: ${
        clientDataResponse.data.client?.activePrograms?.length || 0
      }`
    );
    console.log(
      `   - Programs: ${clientDataResponse.data.programs?.length || 0}`
    );
    console.log(
      `   - Terminals: ${clientDataResponse.data.terminals?.length || 0}`
    );
    console.log(
      `   - Historical Terminals: ${
        clientDataResponse.data.historical_terminals?.length || 0
      }`
    );
    console.log(
      `   - Heatmap GPS Points: ${
        clientDataResponse.data.heatmap?.summary?.totalGpsPoints || 0
      }`
    );

    // Fetch analytics response
    console.log("\n📡 Fetching analytics from server...");
    const analyticsUrl = `${baseUrl}/analytics`;
    console.log(`   URL: ${analyticsUrl}`);

    const analyticsResponse = await axios.get(analyticsUrl, { headers });

    console.log("✅ Successfully fetched analytics!");
    console.log(`   Status: ${analyticsResponse.status}`);

    // Save analytics to JSON file
    const analyticsOutputPath = path.join(
      __dirname,
      "../../analytics_response.json"
    );
    const analyticsJson = JSON.stringify(analyticsResponse.data, null, 2);
    fs.writeFileSync(analyticsOutputPath, analyticsJson, "utf8");

    console.log(`\n💾 Saved analytics response to: ${analyticsOutputPath}`);
    console.log(`\n📊 Analytics response summary:`);
    console.log(
      `   - Client: ${analyticsResponse.data.client?.name || "N/A"} (ID: ${
        analyticsResponse.data.client?.id || "N/A"
      })`
    );
    console.log(
      `   - Active Programs: ${
        analyticsResponse.data.client?.activePrograms?.length || 0
      }`
    );
    console.log(
      `   - Terminals: ${analyticsResponse.data.terminals?.length || 0}`
    );
    console.log(
      `   - Historical Terminals: ${
        analyticsResponse.data.historical_terminals?.length || 0
      }`
    );
    console.log(
      `   - Campaign Metrics: ${
        Object.keys(analyticsResponse.data.campaign_metrics || {}).length
      } programs`
    );
    console.log(
      `   - Zone Coverage: ${
        Object.keys(analyticsResponse.data.zone_coverage || {}).length
      } programs`
    );

    console.log("\n✅ All responses saved successfully!");
  } catch (error) {
    if (error.response) {
      console.error("❌ API Error:");
      console.error(`   Status: ${error.response.status}`);
      console.error(
        `   Message: ${error.response.data?.error || error.message}`
      );
      if (error.response.data?.details) {
        console.error(`   Details: ${error.response.data.details}`);
      }
    } else if (error.request) {
      console.error("❌ Network Error: Could not reach the server");
      console.error(
        "   Make sure the server is running on http://localhost:3000"
      );
      console.error(
        "   Or set API_URL environment variable to your server URL"
      );
    } else {
      console.error("❌ Error:", error.message);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  fetchResponses();
}

module.exports = { fetchResponses };
