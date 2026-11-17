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
        CASE WHEN current_user_info.user_type IN (7, 8, 14) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS isAuthorized,
        JSON_QUERY((
            SELECT
                TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) AS id,
                AZ.Account_Name AS label
            FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
            WHERE current_user_info.user_type IN (7, 8, 14)
              AND AZ.zoho_id IS NOT NULL
              AND NULLIF(LTRIM(RTRIM(AZ.Account_Name)), '') IS NOT NULL
              AND AZ.Account_no IS NOT NULL
            ORDER BY AZ.Account_Name
            FOR JSON PATH
        )) AS accounts
    FROM (
        SELECT
            (
                SELECT TOP (1) user_info.Usertype
                FROM Jobcard.dbo.User_info user_info
                WHERE user_info.Username = NULLIF(LTRIM(RTRIM(CAST(JSON_VALUE($ticket_identity, '$[0].username') AS NVARCHAR(200)))), '')
            ) AS user_type
    ) current_user_info
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
