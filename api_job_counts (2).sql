-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

SELECT 'json' AS component,
(
    SELECT
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM Current_session
                WHERE session_id = sqlpage.cookie('session')
            ) THEN (
                SELECT COUNT(*)
                FROM Jobcard.dbo.SRF_jobs s
                WHERE s.deleted = 0
                  AND s.completed = 0
                  AND s.JC_num IS NOT NULL
                  AND s.DateTime_scheduled >= '2026-01-01'
            )
            ELSE 0
        END AS activeCount,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM Current_session
                WHERE session_id = sqlpage.cookie('session')
            ) THEN (
                SELECT COUNT(*)
                FROM Jobcard.dbo.SRF_jobs s
                WHERE s.completed = 1
                  AND s.deleted = 0
                  AND s.JC_num IS NOT NULL
                  AND s.DateTime_scheduled >= '2026-01-01'
            )
            ELSE 0
        END AS completedCount,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM Current_session
                WHERE session_id = sqlpage.cookie('session')
            ) THEN (
                SELECT COUNT(*)
                FROM Jobcard.dbo.Jobcard_Info a
                INNER JOIN Jobcard.dbo.SRF_jobs b ON b.JC_num = a.JC_num
                WHERE a.tech_cancel = 2
                  AND b.SRF_Operator = (
                      SELECT TOP (1) LEFT(LTRIM(RTRIM(COALESCE(ui.Name, '') + ' ' + COALESCE(ui.Surname, ''))), 100)
                      FROM Jobcard.dbo.User_info ui
                      WHERE ui.Username = LEFT(LTRIM(RTRIM(COALESCE(sqlpage.cookie('username'), ''))), 100)
                  )
                  AND b.deleted = 0
            )
            ELSE 0
        END AS rescheduleCount,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM Current_session
                WHERE session_id = sqlpage.cookie('session')
            ) THEN (
                SELECT COUNT(*)
                FROM Jobcard.dbo.SRF_jobs s
                WHERE COALESCE(s.job_accepted, 0) = 1
                  AND COALESCE(s.deleted, 0) = 1
                  AND COALESCE(s.completed, 0) = 0
                  AND s.JC_num IS NOT NULL
            )
            ELSE 0
        END AS approvalCount
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
