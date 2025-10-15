const { supabase } = require('../config/supabase');

async function investigate() {
  const startDate = '2025-09-26';
  const endDate = '2025-09-28';
  
  console.log(`\n🔍 Investigating zone data for ${startDate} to ${endDate}\n`);
  
  // 1. Check GPS data in date range
  console.log('1️⃣ Checking GPS data...');
  const { data: gpsData, error: gpsError } = await supabase
    .from('terminal_gps_data')
    .select('id, terminal_id, zone_id, data_date, recorded_at')
    .gte('data_date', startDate)
    .lte('data_date', endDate)
    .limit(10);
  
  if (gpsError) {
    console.error('GPS Error:', gpsError);
  } else {
    console.log(`   Found ${gpsData?.length || 0} GPS points (showing first 10)`);
    if (gpsData && gpsData.length > 0) {
      console.log('   Sample:', JSON.stringify(gpsData[0], null, 2));
      const withZones = gpsData.filter(g => g.zone_id !== null);
      console.log(`   GPS points WITH zone_id: ${withZones.length}`);
      console.log(`   GPS points WITHOUT zone_id: ${gpsData.length - withZones.length}`);
    }
  }
  
  // 2. Check playing sessions
  console.log('\n2️⃣ Checking playing sessions...');
  const { data: playingData, error: playingError } = await supabase
    .from('playing')
    .select('terminal_id, program_id, started_at, ended_at, status')
    .gte('started_at', `${startDate}T00:00:00`)
    .lte('started_at', `${endDate}T23:59:59`)
    .limit(10);
  
  if (playingError) {
    console.error('Playing Error:', playingError);
  } else {
    console.log(`   Found ${playingData?.length || 0} playing sessions (showing first 10)`);
    if (playingData && playingData.length > 0) {
      console.log('   Sample:', JSON.stringify(playingData[0], null, 2));
    }
  }
  
  // 3. Check if terminal was active during this period
  console.log('\n3️⃣ Checking terminal 2355209 specifically...');
  const { data: terminalGps, error: termGpsError } = await supabase
    .from('terminal_gps_data')
    .select('*')
    .eq('terminal_id', '2355209')
    .gte('data_date', startDate)
    .lte('data_date', endDate)
    .order('recorded_at', { ascending: true });
    
  if (termGpsError) {
    console.error('Terminal GPS Error:', termGpsError);
  } else {
    console.log(`   Terminal 2355209 GPS points: ${terminalGps?.length || 0}`);
    if (terminalGps && terminalGps.length > 0) {
      const withZone = terminalGps.filter(g => g.zone_id !== null).length;
      const withoutZone = terminalGps.length - withZone;
      console.log(`   - With zone_id: ${withZone}`);
      console.log(`   - Without zone_id (null): ${withoutZone}`);
      console.log(`   First point:`, terminalGps[0]);
      console.log(`   Last point:`, terminalGps[terminalGps.length - 1]);
    }
  }
  
  const { data: terminalPlaying, error: termPlayError } = await supabase
    .from('playing')
    .select('*')
    .eq('terminal_id', '2355209')
    .eq('program_id', 2389650)
    .gte('started_at', `${startDate}T00:00:00`);
    
  if (termPlayError) {
    console.error('Terminal Playing Error:', termPlayError);
  } else {
    console.log(`   Terminal 2355209 playing sessions: ${terminalPlaying?.length || 0}`);
    if (terminalPlaying && terminalPlaying.length > 0) {
      terminalPlaying.forEach((session, i) => {
        console.log(`   Session ${i+1}: ${session.started_at} to ${session.ended_at || 'ongoing'} (status: ${session.status})`);
      });
    }
  }
}

investigate().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
