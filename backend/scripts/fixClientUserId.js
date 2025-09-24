const { supabase } = require("../config/supabase");

async function fixClientUserId() {
  try {
    console.log("🔧 Fixing client user_id to match JWT...");

    // The actual user_id from the JWT token
    const actualUserId = "8e2eef6b-8d0d-425d-b4b1-a4a9d1def656";

    // Update the client record
    const { data, error } = await supabase
      .from("client")
      .update({ user_id: actualUserId })
      .eq("id", 1);

    if (error) {
      console.log("❌ Error updating client:", error.message);
    } else {
      console.log("✅ Client user_id updated successfully");
      console.log("📋 Client now linked to user_id:", actualUserId);
    }

    // Verify the update
    const { data: clientData, error: fetchError } = await supabase
      .from("client")
      .select("*")
      .eq("id", 1)
      .single();

    if (fetchError) {
      console.log("❌ Error fetching client:", fetchError.message);
    } else {
      console.log("✅ Client verification:");
      console.log("  - ID:", clientData.id);
      console.log("  - Name:", clientData.name);
      console.log("  - User ID:", clientData.user_id);
    }
  } catch (error) {
    console.error("❌ Error fixing client user_id:", error.message);
  }
}

// Run if called directly
if (require.main === module) {
  fixClientUserId();
}

module.exports = { fixClientUserId };
