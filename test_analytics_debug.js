const { supabase } = require("./backend/config/supabase");

async function test() {
  try {
    const { data: authData } = await supabase.auth.signInWithPassword({
      email: "test@clientcorp.com",
      password: "testpassword123",
    });

    const token = authData.session.access_token;

    console.log("🔍 Testing Analytics Endpoint with 30 days...\n");

    const response = await fetch(
      "http://localhost:3000/analytics?gpsDays=30",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const data = await response.json();

    console.log("📊 Time Distribution:");
    console.log(JSON.stringify(data.time_distribution, null, 2));

    console.log("\n📍 Checking direct GPS endpoint for comparison (14 days)...\n");

    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const gpsResponse = await fetch(
      `http://localhost:3000/client/gps?gpsStartDate=${startDate}&gpsEndDate=${endDate}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const gpsData = await gpsResponse.json();

    if (gpsData.heatmap && gpsData.heatmap.programs && gpsData.heatmap.programs[0]) {
      console.log("📊 GPS Endpoint Time Distribution (14 days):");
      console.log(
        JSON.stringify(gpsData.heatmap.programs[0].timeDistribution, null, 2)
      );
      console.log(
        "\n📏 GPS Endpoint Total Distance:",
        gpsData.heatmap.programs[0].distanceMiles,
        "miles"
      );
      console.log(
        "📏 GPS Endpoint Total Points:",
        gpsData.heatmap.programs[0].totalPoints
      );
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

test();

