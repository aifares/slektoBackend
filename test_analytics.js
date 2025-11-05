const axios = require("axios");

// You'll need to provide a valid auth token
const AUTH_TOKEN = process.env.SUPABASE_TOKEN || process.argv[2] || "";

if (!AUTH_TOKEN) {
  console.error("❌ Please provide a token:");
  console.error("   node test_analytics.js <token>");
  console.error("   or: SUPABASE_TOKEN=<token> node test_analytics.js");
  process.exit(1);
}

const BASE_URL = "http://localhost:3000";

async function testAnalytics() {
  console.log("🧪 Testing analytics endpoint...\n");

  const headers = {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    console.log("📊 Making FIRST request...");
    const start1 = Date.now();
    const response1 = await axios.get(`${BASE_URL}/analytics`, {
      headers,
      timeout: 120000, // 2 minute timeout
    });
    const duration1 = Date.now() - start1;
    console.log(`✅ First request completed in ${duration1}ms`);
    console.log(`   Response status: ${response1.status}`);
    console.log(
      `   Response size: ${JSON.stringify(response1.data).length} bytes\n`
    );

    // Wait a bit between requests
    console.log("⏳ Waiting 2 seconds before second request...\n");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("📊 Making SECOND request...");
    const start2 = Date.now();
    const response2 = await axios.get(`${BASE_URL}/analytics`, {
      headers,
      timeout: 120000, // 2 minute timeout
    });
    const duration2 = Date.now() - start2;
    console.log(`✅ Second request completed in ${duration2}ms`);
    console.log(`   Response status: ${response2.status}`);
    console.log(
      `   Response size: ${JSON.stringify(response2.data).length} bytes\n`
    );

    console.log("✅ Both requests completed successfully!");
  } catch (error) {
    if (error.code === "ECONNABORTED") {
      console.error("❌ Request timed out after 120 seconds");
    } else if (error.response) {
      console.error(
        `❌ Error: ${error.response.status} - ${
          error.response.data?.error || error.message
        }`
      );
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

testAnalytics();
