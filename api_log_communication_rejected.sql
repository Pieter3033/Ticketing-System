
SET log_context = sqlpage.run_sql('sqlpage/quick_log_submission_context.sql');
SELECT 'json' AS component,(SELECT CAST(0 AS bit) AS success,
 COALESCE(JSON_VALUE($log_context,'$[0].status'),N'invalid_request') AS status,
 COALESCE(JSON_VALUE($log_context,'$[0].message'),N'The log was not queued. Your draft has been kept.') AS message,
 CAST(1 AS bit) AS definitelyNotSaved
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS contents;
