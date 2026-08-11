UPDATE `brain_vector_sync_jobs`
SET `status` = 'retry_scheduled'
WHERE `status` = 'failed' AND `attempt_count` < 6;
