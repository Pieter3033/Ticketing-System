-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

SELECT 'json' AS component,
(
    SELECT
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM Current_session
                WHERE session_id = sqlpage.cookie('session') AND $ticket_user_id IS NOT NULL AND $ticket_is_requester = 0
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
                WHERE session_id = sqlpage.cookie('session') AND $ticket_user_id IS NOT NULL AND $ticket_is_requester = 0
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
                WHERE session_id = sqlpage.cookie('session') AND $ticket_user_id IS NOT NULL AND $ticket_is_requester = 0
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
                WHERE session_id = sqlpage.cookie('session') AND $ticket_user_id IS NOT NULL AND $ticket_is_requester = 0
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
