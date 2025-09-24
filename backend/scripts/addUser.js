const { supabase } = require("../config/supabase");

async function addUser(userId, email, name) {
  try {
    console.log(`🔧 Adding user: ${name} (${email})`);
    
    // Check if client already exists
    const { data: existingClient, error: checkError } = await supabase
      .from("client")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (existingClient) {
      console.log("⚠️ Client already exists:", existingClient);
      return existingClient;
    }

    // Create the client
    const newClient = {
      name: name,
      user_id: userId,
      email: email,
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
      return null;
    } else {
      console.log("✅ Client created successfully:", createdClient);
      return createdClient;
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    return null;
  }
}

// Run if called directly with command line arguments
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log("Usage: node addUser.js <userId> <email> <name>");
    console.log("Example: node addUser.js 123e4567-e89b-12d3-a456-426614174000 user@example.com 'John Doe'");
    process.exit(1);
  }
  
  const [userId, email, name] = args;
  addUser(userId, email, name);
}

module.exports = { addUser };
