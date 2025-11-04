const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { supabase } = require("../config/supabase");

async function fetchClientData() {
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
          console.log("\n💡 Please run: node backend/scripts/generateTestToken.js");
          console.log("   Then use that token manually or set SUPABASE_TOKEN env var");
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

    console.log("📡 Fetching clientData from server...");
    
    const baseUrl = process.env.API_URL || "http://localhost:3000";
    const url = `${baseUrl}/clientData`;
    
    console.log(`   URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    console.log("✅ Successfully fetched clientData!");
    console.log(`   Status: ${response.status}`);
    
    // Save to JSON file
    const outputPath = path.join(__dirname, "../../clientData_response.json");
    const jsonData = JSON.stringify(response.data, null, 2);
    
    fs.writeFileSync(outputPath, jsonData, "utf8");
    
    console.log(`\n💾 Saved response to: ${outputPath}`);
    console.log(`\n📊 Response summary:`);
    console.log(`   - Client: ${response.data.client?.name || "N/A"} (ID: ${response.data.client?.id || "N/A"})`);
    console.log(`   - Active Programs: ${response.data.client?.activePrograms?.length || 0}`);
    console.log(`   - Programs: ${response.data.programs?.length || 0}`);
    console.log(`   - Terminals: ${response.data.terminals?.length || 0}`);
    console.log(`   - Historical Terminals: ${response.data.historical_terminals?.length || 0}`);
    console.log(`   - Heatmap GPS Points: ${response.data.heatmap?.summary?.totalGpsPoints || 0}`);
    
  } catch (error) {
    if (error.response) {
      console.error("❌ API Error:");
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Message: ${error.response.data?.error || error.message}`);
      if (error.response.data?.details) {
        console.error(`   Details: ${error.response.data.details}`);
      }
    } else if (error.request) {
      console.error("❌ Network Error: Could not reach the server");
      console.error("   Make sure the server is running on http://localhost:3000");
      console.error("   Or set API_URL environment variable to your server URL");
    } else {
      console.error("❌ Error:", error.message);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  fetchClientData();
}

module.exports = { fetchClientData };

