const { supabase } = require("../config/supabase");

/**
 * Distributed locking utility for preventing duplicate cron job execution
 * across multiple machines/instances.
 *
 * Uses a database table with atomic INSERT operations to ensure only
 * one instance can acquire a lock at a time.
 */

const LOCK_TIMEOUT_MINUTES = 10; // Maximum time a lock can be held (safety measure)

/**
 * Acquire a distributed lock for a job
 * @param {string} jobName - Unique identifier for the job (e.g., 'fetch_gps_live')
 * @param {number} timeoutMinutes - Optional timeout in minutes (default: 10)
 * @returns {Promise<boolean>} - True if lock was acquired, false if already locked
 */
async function acquireLock(jobName, timeoutMinutes = LOCK_TIMEOUT_MINUTES) {
  try {
    // First, clean up any stale locks that may have been left behind
    // (e.g., if a process crashed while holding a lock)
    const lockExpiryTime = new Date();
    lockExpiryTime.setMinutes(lockExpiryTime.getMinutes() - timeoutMinutes);

    await supabase
      .from("job_locks")
      .delete()
      .eq("job_name", jobName)
      .lt("acquired_at", lockExpiryTime.toISOString());

    // Try to acquire the lock by inserting a new row
    // The unique constraint on job_name ensures only one instance succeeds
    const { data, error } = await supabase
      .from("job_locks")
      .insert({
        job_name: jobName,
        acquired_at: new Date().toISOString(),
        machine_id: process.env.FLY_ALLOC_ID || process.env.HOSTNAME || "unknown",
      })
      .select();

    if (error) {
      // If it's a unique constraint violation, the lock is already held
      if (
        error.message?.includes("duplicate key") ||
        error.message?.includes("unique constraint") ||
        error.code === "23505"
      ) {
        // Lock is already held by another instance
        return false;
      }
      // Other database errors
      throw error;
    }

    // Lock acquired successfully
    return data && data.length > 0;
  } catch (error) {
    console.error(`❌ Error acquiring lock for ${jobName}:`, error.message);
    throw error;
  }
}

/**
 * Release a distributed lock for a job
 * @param {string} jobName - Unique identifier for the job
 */
async function releaseLock(jobName) {
  try {
    const { error } = await supabase
      .from("job_locks")
      .delete()
      .eq("job_name", jobName);

    if (error) {
      console.error(`⚠️  Error releasing lock for ${jobName}:`, error.message);
    }
  } catch (error) {
    console.error(`❌ Error releasing lock for ${jobName}:`, error.message);
  }
}

/**
 * Execute a function with a distributed lock
 * @param {string} jobName - Unique identifier for the job
 * @param {Function} fn - Function to execute while holding the lock
 * @param {number} timeoutMinutes - Optional timeout in minutes
 * @returns {Promise<*>} - Result of the function execution
 */
async function withLock(jobName, fn, timeoutMinutes = LOCK_TIMEOUT_MINUTES) {
  const lockAcquired = await acquireLock(jobName, timeoutMinutes);

  if (!lockAcquired) {
    console.log(`🔒 Lock already held for job: ${jobName}. Skipping execution.`);
    return null;
  }

  try {
    console.log(`🔓 Lock acquired for job: ${jobName}`);
    const result = await fn();
    return result;
  } finally {
    await releaseLock(jobName);
    console.log(`🔓 Lock released for job: ${jobName}`);
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  withLock,
};

