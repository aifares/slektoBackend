const { supabase } = require("../config/supabase");

async function generateTestToken() {
  try {
    console.log("🔑 Generating test access token...");

    // Create a test user with the same user_id we used for the client
    const testUser = {
      id: "00000000-0000-0000-0000-000000000001",
      email: "test@clientcorp.com",
      email_confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    // Sign in as the test user to get a proper JWT
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: "test@clientcorp.com",
        password: "testpassword123",
      });

    if (authError) {
      console.log("⚠️ User doesn't exist, creating test user...");

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
        console.log("❌ Sign up error:", signUpError.message);
        return;
      }

      console.log("✅ Test user created, now signing in...");

      // Now sign in
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: "test@clientcorp.com",
          password: "testpassword123",
        });

      if (signInError) {
        console.log("❌ Sign in error:", signInError.message);
        return;
      }

      console.log("✅ Successfully signed in!");
      console.log("🔑 Access Token:", signInData.session.access_token);
      console.log("\n📋 Use this token in your curl command:");
      console.log(`curl -X GET "http://localhost:3000/clientData" \\`);
      console.log(
        `  -H "Authorization: Bearer ${signInData.session.access_token}" \\`
      );
      console.log(`  -H "Content-Type: application/json"`);
    } else {
      console.log("✅ Successfully signed in!");
      console.log("🔑 Access Token:", authData.session.access_token);
      console.log("\n📋 Use this token in your curl command:");
      console.log(`curl -X GET "http://localhost:3000/clientData" \\`);
      console.log(
        `  -H "Authorization: Bearer ${authData.session.access_token}" \\`
      );
      console.log(`  -H "Content-Type: application/json"`);
    }
  } catch (error) {
    console.error("❌ Error generating token:", error.message);
  }
}

// Run if called directly
if (require.main === module) {
  generateTestToken();
}

module.exports = { generateTestToken };
