-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

SELECT 'json' AS component,
(
    SELECT
        CASE WHEN current_user_info.user_type IN (7, 8) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS isAuthorized,
        JSON_QUERY((
            SELECT
                TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) AS id,
                AZ.Account_Name AS label
            FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
            WHERE current_user_info.user_type IN (7, 8)
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
                WHERE user_info.Username = NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '')
            ) AS user_type
    ) current_user_info
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
