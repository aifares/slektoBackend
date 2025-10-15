const { supabase } = require('../config/supabase');

async function checkStats() {
  console.log('\n📊 GPS Data Zone Coverage Statistics\n');
  
  // Total GPS points for terminal 2355209
  const { count: total, error: allError } = await supabase
    .from('terminal_gps_data')
    .select('*', { count: 'exact', head: true })
    .eq('terminal_id', '2355209');
  
  // GPS points WITH zone_id
  const { count: hasZone, error: withError } = await supabase
    .from('terminal_gps_data')
    .select('*', { count: 'exact', head: true })
    .eq('terminal_id', '2355209')
    .not('zone_id', 'is', null);
  
  // GPS points WITHOUT zone_id
  const { count: noZone, error: withoutError } = await supabase
    .from('terminal_gps_data')
    .select('*', { count: 'exact', head: true })
    .eq('terminal_id', '2355209')
    .is('zone_id', null);
  
  console.log(`Terminal 2355209 GPS Statistics:`);
  console.log(`  Total GPS points: ${total || 0}`);
  console.log(`  Points WITH zone_id: ${hasZone || 0} (${total > 0 ? ((hasZone/total)*100).toFixed(1) : 0}%)`);
  console.log(`  Points WITHOUT zone_id: ${noZone || 0} (${total > 0 ? ((noZone/total)*100).toFixed(1) : 0}%)`);
  
  console.log(`\n💡 To get accurate zone analytics, we need to backfill zone_id for ${noZone || 0} historical GPS points.`);
}

checkStats().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
