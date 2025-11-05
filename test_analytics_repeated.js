const axios = require("axios");

const AUTH_TOKEN = process.argv[2] || "";

if (!AUTH_TOKEN) {
  console.error(
    "❌ Please provide a token: node test_analytics_repeated.js <token>"
  );
  process.exit(1);
}

const BASE_URL = "http://localhost:3000";

async function testMultipleTimes() {
  console.log("🧪 Testing analytics endpoint 5 times in a row...\n");

  const headers = {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "Content-Type": "application/json",
  };

  for (let i = 1; i <= 5; i++) {
    try {
      console.log(`📊 Making request #${i}...`);
      const start = Date.now();

      const response = await axios.get(`${BASE_URL}/analytics`, {
        headers,
        timeout: 120000, // 2 minute timeout
      });

      const duration = Date.now() - start;
      console.log(`✅ Request #${i} completed in ${duration}ms`);

      if (i < 5) {
        console.log(`⏳ Waiting 1 second before next request...\n`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (error.code === "ECONNABORTED") {
        console.error(`❌ Request #${i} timed out after 120 seconds`);
      } else if (error.response) {
        console.error(
          `❌ Request #${i} error: ${error.response.status} - ${
            error.response.data?.error || error.message
          }`
        );
      } else {
        console.error(`❌ Request #${i} error: ${error.message}`);
      }
      process.exit(1);
    }
  }

  console.log("\n✅ All 5 requests completed successfully!");
}

testMultipleTimes();
