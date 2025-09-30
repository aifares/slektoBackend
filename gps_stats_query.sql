
-- Get all programs with playing history
SELECT DISTINCT program_id, program_name FROM playing ORDER BY program_id;

-- Get GPS count by terminal
SELECT terminal_id, COUNT(*) as gps_points 
FROM terminal_gps_data 
WHERE data_date >= '2025-09-20' AND data_date <= '2025-09-30'
GROUP BY terminal_id;

-- Get terminals by program
SELECT program_id, program_name, terminal_id, COUNT(*) as sessions
FROM playing 
GROUP BY program_id, program_name, terminal_id
ORDER BY program_id, terminal_id;

