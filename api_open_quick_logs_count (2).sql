-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

SELECT 'json' AS component,
(
    SELECT
        (
            SELECT COUNT(*)
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            CROSS JOIN
            (
                SELECT
                    NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
            ) cookie_user
            OUTER APPLY
            (
                SELECT TOP (1)
                    NULLIF(LTRIM(RTRIM(CONCAT(user_info.Name, ' ', user_info.Surname))), '') AS operator_name
                FROM Jobcard.dbo.User_info user_info
                WHERE user_info.Username = cookie_user.username
            ) current_operator
            WHERE ISNULL(quick_log.[close], 0) = 0
              AND NULLIF(LTRIM(RTRIM(quick_log.reg_no)), '') IS NOT NULL
              AND (
                    NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') = current_operator.operator_name
                    OR NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') = cookie_user.username
                  )
        ) AS totalOpenCount
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
