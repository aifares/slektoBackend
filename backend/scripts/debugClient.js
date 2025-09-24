const { supabase } = require("../config/supabase");

async function debugClient() {
  try {
    const userId = "361ff73c-bc3e-4ed4-8394-88660db2e5cd";

    console.log("🔍 Debugging client for user:", userId);

    // Check if client exists
    const { data: clientData, error: clientError } = await supabase
      .from("client")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (clientError) {
      console.log("❌ Client not found:", clientError.message);

      // Create the client manually
      console.log("🔧 Creating client manually...");

      const newClient = {
        name: "tamannainna",
        user_id: userId,
        email: "tamannainna@icloud.com",
        email_verified: true,
        account_status: "active",
        role: "user",
        subscription_tier: "free",
        last_login_at: new Date().toISOString(),
      };

      const { data: createdClient, error: createError } = await supabase
        .from("client")
        .insert(newClient)
        .select("*")
        .single();

      if (createError) {
        console.log("❌ Failed to create client:", createError.message);
      } else {
        console.log("✅ Client created successfully:", createdClient);
      }
    } else {
      console.log("✅ Client found:", clientData);
    }

    // Check all clients
    const { data: allClients, error: allClientsError } = await supabase
      .from("client")
      .select("*");

    if (allClientsError) {
      console.log("❌ Error fetching all clients:", allClientsError.message);
    } else {
      console.log("📋 All clients in database:");
      allClients.forEach((client) => {
        console.log(
          `  - ID: ${client.id}, Name: ${client.name}, User ID: ${client.user_id}`
        );
      });
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// Run if called directly
if (require.main === module) {
  debugClient();
}

module.exports = { debugClient };
