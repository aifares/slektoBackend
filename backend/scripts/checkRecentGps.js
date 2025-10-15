const { supabase } = require('../config/supabase');

async function checkRecent() {
  console.log('\n🔍 Checking most recent GPS data...\n');
  
  const { data, error } = await supabase
    .from('terminal_gps_data')
    .select('*')
    .order('inserted_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log(`Found ${data.length} most recent GPS points:\n`);
  data.forEach((point, i) => {
    console.log(`${i+1}. Terminal: ${point.terminal_id}`);
    console.log(`   Inserted: ${point.inserted_at}`);
    console.log(`   Recorded: ${point.recorded_at}`);
    console.log(`   Zone ID: ${point.zone_id || 'NULL ❌'}`);
    console.log(`   Location: ${point.latitude}, ${point.longitude}\n`);
  });
  
  // Check stats
  const withZone = data.filter(p => p.zone_id !== null).length;
  const withoutZone = data.length - withZone;
  console.log(`\n📊 Stats for last 10 points:`);
  console.log(`   With zone_id: ${withZone}`);
  console.log(`   Without zone_id: ${withoutZone}`);
}

checkRecent().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
