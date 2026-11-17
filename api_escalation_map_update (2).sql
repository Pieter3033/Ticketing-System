-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

WITH request_data AS (
    SELECT
        NULLIF(LTRIM(RTRIM(CAST(:company AS NVARCHAR(200)))), '') AS company,
        NULLIF(LTRIM(RTRIM(CAST(:fleet_code AS NVARCHAR(100)))), '') AS fleet_code,
        NULLIF(LTRIM(RTRIM(CAST(:new_zoho_id AS NVARCHAR(100)))), '') AS new_zoho_id,
        NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
),
current_user_info AS (
    SELECT
        request_data.*,
        (
            SELECT TOP (1) user_info.Usertype
            FROM Jobcard.dbo.User_info user_info
            WHERE user_info.Username = request_data.username
        ) AS user_type
    FROM request_data
),
validation AS (
    SELECT
        current_user_info.*,
        CASE WHEN current_user_info.user_type IN (7, 8) THEN 1 ELSE 0 END AS is_authorized,
        CASE WHEN EXISTS (
            SELECT 1
            FROM Jobcard.dbo.Companies C
            WHERE C.Company = current_user_info.company
              AND C.Fleet_Code = current_user_info.fleet_code
        ) THEN 1 ELSE 0 END AS has_company_fleet,
        CASE WHEN EXISTS (
            SELECT 1
            FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
            WHERE TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) = current_user_info.new_zoho_id
        ) THEN 1 ELSE 0 END AS has_zoho_account
    FROM current_user_info
)
INSERT INTO CC.dbo.mapping_log (
    log_datetime,
    company,
    fleet_code,
    old_zoho_account,
    new_zoho_account,
    username
)
SELECT
    DATEADD(HOUR, 2, SYSUTCDATETIME()),
    C.Company,
    C.Fleet_Code,
    AZ_old.Account_Name,
    AZ_new.Account_Name,
    validation.username
FROM validation
JOIN Jobcard.dbo.Companies C
    ON C.Company = validation.company
   AND C.Fleet_Code = validation.fleet_code
LEFT JOIN Pulsit_comparison.dbo.Accounts_ZOHO AZ_old
    ON TRY_CONVERT(NVARCHAR(100), AZ_old.zoho_id) = TRY_CONVERT(NVARCHAR(100), C.escallation_no)
LEFT JOIN Pulsit_comparison.dbo.Accounts_ZOHO AZ_new
    ON TRY_CONVERT(NVARCHAR(100), AZ_new.zoho_id) = validation.new_zoho_id
WHERE validation.is_authorized = 1
  AND validation.has_company_fleet = 1
  AND validation.has_zoho_account = 1;

WITH request_data AS (
    SELECT
        NULLIF(LTRIM(RTRIM(CAST(:company AS NVARCHAR(200)))), '') AS company,
        NULLIF(LTRIM(RTRIM(CAST(:fleet_code AS NVARCHAR(100)))), '') AS fleet_code,
        NULLIF(LTRIM(RTRIM(CAST(:new_zoho_id AS NVARCHAR(100)))), '') AS new_zoho_id,
        NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
),
validation AS (
    SELECT
        request_data.*,
        CASE WHEN (
            SELECT TOP (1) user_info.Usertype
            FROM Jobcard.dbo.User_info user_info
            WHERE user_info.Username = request_data.username
        ) IN (7, 8) THEN 1 ELSE 0 END AS is_authorized
    FROM request_data
)
UPDATE InfofleetCompany
SET FleetSageReference = validation.new_zoho_id
FROM [89.234.65.126,25435].Infofleetsql_PULS.dbo.company InfofleetCompany
CROSS JOIN validation
WHERE InfofleetCompany.RecNo = (
    SELECT TOP (1) C.Fleet_id
    FROM Jobcard.dbo.Companies C
    WHERE C.Company = validation.company
      AND C.Fleet_Code = validation.fleet_code
)
  AND validation.is_authorized = 1
  AND EXISTS (
      SELECT 1
      FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
      WHERE TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) = validation.new_zoho_id
  );

WITH request_data AS (
    SELECT
        NULLIF(LTRIM(RTRIM(CAST(:company AS NVARCHAR(200)))), '') AS company,
        NULLIF(LTRIM(RTRIM(CAST(:fleet_code AS NVARCHAR(100)))), '') AS fleet_code,
        NULLIF(LTRIM(RTRIM(CAST(:new_zoho_id AS NVARCHAR(100)))), '') AS new_zoho_id,
        NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
),
validation AS (
    SELECT
        request_data.*,
        CASE WHEN (
            SELECT TOP (1) user_info.Usertype
            FROM Jobcard.dbo.User_info user_info
            WHERE user_info.Username = request_data.username
        ) IN (7, 8) THEN 1 ELSE 0 END AS is_authorized
    FROM request_data
)
UPDATE Companies
SET escallation_no = validation.new_zoho_id
FROM Jobcard.dbo.Companies Companies
CROSS JOIN validation
WHERE Companies.Company = validation.company
  AND Companies.Fleet_Code = validation.fleet_code
  AND validation.is_authorized = 1
  AND EXISTS (
      SELECT 1
      FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
      WHERE TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) = validation.new_zoho_id
  );

SELECT 'json' AS component,
(
    SELECT
        CASE WHEN current_user_info.user_type IN (7, 8) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS isAuthorized,
        CASE
            WHEN current_user_info.user_type NOT IN (7, 8) OR current_user_info.user_type IS NULL
            THEN CAST(0 AS bit)
            WHEN current_user_info.company IS NULL OR current_user_info.fleet_code IS NULL OR current_user_info.new_zoho_id IS NULL
            THEN CAST(0 AS bit)
            WHEN NOT EXISTS (
                SELECT 1
                FROM Jobcard.dbo.Companies C
                WHERE C.Company = current_user_info.company
                  AND C.Fleet_Code = current_user_info.fleet_code
            )
            THEN CAST(0 AS bit)
            WHEN NOT EXISTS (
                SELECT 1
                FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
                WHERE TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) = current_user_info.new_zoho_id
            )
            THEN CAST(0 AS bit)
            ELSE CAST(1 AS bit)
        END AS ok,
        CASE
            WHEN current_user_info.user_type NOT IN (7, 8) OR current_user_info.user_type IS NULL
            THEN 'Escalation mapping is limited to authorized users.'
            WHEN current_user_info.company IS NULL OR current_user_info.fleet_code IS NULL OR current_user_info.new_zoho_id IS NULL
            THEN 'Company, fleet, and Zoho account are required.'
            WHEN NOT EXISTS (
                SELECT 1
                FROM Jobcard.dbo.Companies C
                WHERE C.Company = current_user_info.company
                  AND C.Fleet_Code = current_user_info.fleet_code
            )
            THEN 'The selected company and fleet could not be found.'
            WHEN NOT EXISTS (
                SELECT 1
                FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
                WHERE TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) = current_user_info.new_zoho_id
            )
            THEN 'The selected Zoho account could not be found.'
            ELSE 'Escalation mapping updated.'
        END AS message,
        current_user_info.company,
        current_user_info.fleet_code AS fleet,
        current_user_info.new_zoho_id AS zohoId,
        (
            SELECT TOP (1) AZ.Account_Name
            FROM Pulsit_comparison.dbo.Accounts_ZOHO AZ
            WHERE TRY_CONVERT(NVARCHAR(100), AZ.zoho_id) = current_user_info.new_zoho_id
        ) AS zohoAccount
    FROM (
        SELECT
            request_data.*,
            (
                SELECT TOP (1) user_info.Usertype
                FROM Jobcard.dbo.User_info user_info
                WHERE user_info.Username = request_data.username
            ) AS user_type
        FROM (
            SELECT
                NULLIF(LTRIM(RTRIM(CAST(:company AS NVARCHAR(200)))), '') AS company,
                NULLIF(LTRIM(RTRIM(CAST(:fleet_code AS NVARCHAR(100)))), '') AS fleet_code,
                NULLIF(LTRIM(RTRIM(CAST(:new_zoho_id AS NVARCHAR(100)))), '') AS new_zoho_id,
                NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
        ) request_data
    ) current_user_info
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
