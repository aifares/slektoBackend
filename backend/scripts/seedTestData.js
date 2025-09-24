const { supabase } = require("../config/supabase");

async function seedTestData() {
  console.log("🌱 Creating test client and campaign for program ID 2460739...");

  try {
    // 1. Create a test client
    const testClient = {
      name: "Test Client Corp",
      user_id: "00000000-0000-0000-0000-000000000001", // Test UUID
      email: "test@clientcorp.com",
      email_verified: true,
      account_status: "active",
      role: "user",
      subscription_tier: "premium",
      last_login_at: new Date().toISOString(),
    };

    console.log("📝 Creating test client...");
    const { data: clientData, error: clientError } = await supabase
      .from("client")
      .upsert(testClient, { onConflict: "user_id" })
      .select("*")
      .single();

    if (clientError) {
      throw new Error(`Failed to create client: ${clientError.message}`);
    }
    console.log(
      "✅ Client created:",
      clientData.name,
      "(ID:",
      clientData.id,
      ")"
    );

    // 2. Create campaign linking client to program ID 2460739
    const testCampaign = {
      client_id: clientData.id,
      program_id: 2460739,
      hours_bought: 168.0, // 1 week
      start_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
      end_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      status: "active",
    };

    console.log("📊 Creating test campaign...");
    const { error: campaignError } = await supabase
      .from("campaign")
      .upsert(testCampaign, { onConflict: "client_id,program_id" });

    if (campaignError) {
      console.warn("⚠️ Failed to create campaign:", campaignError.message);
    } else {
      console.log(
        "✅ Campaign created: Client",
        clientData.id,
        "→ Program",
        testCampaign.program_id
      );
    }

    console.log("\n🎉 Test client and campaign created!");
    console.log("\n📋 Summary:");
    console.log(`- Client: ${clientData.name} (ID: ${clientData.id})`);
    console.log(`- User ID: ${clientData.user_id}`);
    console.log(`- Program ID: 2460739`);
    console.log(
      `- Campaign: Active from ${testCampaign.start_at} to ${testCampaign.end_at}`
    );

    console.log("\n🧪 To test the clientData endpoint:");
    console.log(`1. Use this user_id for auth: ${clientData.user_id}`);
    console.log("2. Call GET /clientData");
    console.log("3. Call GET /clientData?gpsProgramId=2460739");
    console.log("4. Call GET /clientData?gpsDays=3");

    console.log("\n⚠️ Note: This assumes you already have:");
    console.log("- Terminals in the database");
    console.log("- Program ID 2460739 in the programs table");
    console.log("- Playing records in the playing table");
    console.log("- GPS data in the terminal_gps_data table");
  } catch (error) {
    console.error("❌ Error creating test data:", error.message);
    throw error;
  }
}

// Run the seeding if this file is executed directly
if (require.main === module) {
  seedTestData()
    .then(() => {
      console.log("✅ Seeding completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Seeding failed:", error);
      process.exit(1);
    });
}

module.exports = { seedTestData };
