const { syncMediaFromColorLight } = require("../services/mediaSync");

async function test() {
  console.log("🧪 Testing media sync directly...\n");
  
  try {
    const result = await syncMediaFromColorLight();
    
    console.log("\n📋 RESULT:");
    console.log(JSON.stringify(result, null, 2));
    
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();

