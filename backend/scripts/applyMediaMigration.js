const { supabase } = require("../config/supabase");
const fs = require("fs");
const path = require("path");

async function applyMigration() {
  try {
    console.log("📋 Reading migration file...");
    fly;

    const migrationPath = path.join(
      __dirname,
      "../../database/migrations/009_add_media_metadata_to_files.sql"
    );

    const sql = fs.readFileSync(migrationPath, "utf8");

    console.log("🚀 Applying migration to Supabase...");
    console.log(
      "⚠️  Note: This uses the Supabase client, which may have limitations."
    );
    console.log("⚠️  Recommended: Apply via Supabase Dashboard SQL Editor\n");

    // Split by semicolons and execute each statement
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    console.log(`📊 Found ${statements.length} SQL statements\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip comments
      if (statement.startsWith("--") || statement.startsWith("/*")) {
        continue;
      }

      console.log(`⚙️  Executing statement ${i + 1}/${statements.length}...`);

      try {
        const { error } = await supabase.rpc("exec_sql", {
          sql_query: statement,
        });

        if (error) {
          console.error(`❌ Error on statement ${i + 1}:`, error.message);
          console.error(`Statement: ${statement.substring(0, 100)}...`);
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully`);
        }
      } catch (err) {
        console.error(`❌ Exception on statement ${i + 1}:`, err.message);
      }
    }

    console.log("\n✅ Migration process completed!");
    console.log(
      "\n💡 Verify in Supabase Dashboard that all columns were added"
    );
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

applyMigration();
