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
                C.Company AS company,
                C.Fleet_Code AS fleet,
                RiskCompany.customerid AS customerId,
                COALESCE(AZ.Account_Name, 'N/A') AS zohoAccount,
                AZ.zoho_id AS zohoId,
                CASE WHEN EXISTS (
                    SELECT 1
                    FROM CC.dbo.el_info escalation
                    WHERE escalation.Company = C.Company
                      AND escalation.Fleet_Code = C.Fleet_Code
                      AND escalation.completed = 1
                ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS hasUniqueEscalation,
                (
                    SELECT TOP (1) escalation.ID
                    FROM CC.dbo.el_info escalation
                    WHERE escalation.Company = C.Company
                      AND escalation.Fleet_Code = C.Fleet_Code
                      AND escalation.completed = 1
                    ORDER BY escalation.ID DESC
                ) AS uniqueEscalationId
            FROM Jobcard.dbo.Companies C
            LEFT JOIN Pulsit_comparison.dbo.Accounts_ZOHO AZ
                ON AZ.zoho_id = C.escallation_no
            OUTER APPLY (
                SELECT TOP (1)
                    RiskCompanyLookup.customerid
                FROM Risk.dbo.Company RiskCompanyLookup
                WHERE RiskCompanyLookup.company = C.Company
                  AND RiskCompanyLookup.customerid IS NOT NULL
                GROUP BY RiskCompanyLookup.customerid
                ORDER BY RiskCompanyLookup.customerid
            ) RiskCompany
            WHERE current_user_info.user_type IN (7, 8)
              AND NULLIF(LTRIM(RTRIM(C.Company)), '') IS NOT NULL
              AND NULLIF(LTRIM(RTRIM(C.Fleet_Code)), '') IS NOT NULL
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($company AS NVARCHAR(200)))), '') IS NULL
                  OR C.Company LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($company AS NVARCHAR(200)))), '') + '%'
              )
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($fleet AS NVARCHAR(100)))), '') IS NULL
                  OR C.Fleet_Code LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($fleet AS NVARCHAR(100)))), '') + '%'
              )
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') IS NULL
                  OR C.Company LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR C.Fleet_Code LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR AZ.Account_Name LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
              )
            ORDER BY C.Company, C.Fleet_Code
            FOR JSON PATH
        )) AS escalations,
        JSON_QUERY((
            SELECT DISTINCT TOP (500)
                C.Company AS value,
                C.Company AS label
            FROM Jobcard.dbo.Companies C
            WHERE current_user_info.user_type IN (7, 8)
              AND NULLIF(LTRIM(RTRIM(C.Company)), '') IS NOT NULL
            ORDER BY C.Company
            FOR JSON PATH
        )) AS companies,
        JSON_QUERY((
            SELECT DISTINCT TOP (500)
                C.Fleet_Code AS value,
                C.Fleet_Code AS label
            FROM Jobcard.dbo.Companies C
            WHERE current_user_info.user_type IN (7, 8)
              AND NULLIF(LTRIM(RTRIM(C.Fleet_Code)), '') IS NOT NULL
            ORDER BY C.Fleet_Code
            FOR JSON PATH
        )) AS fleets
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
