-- Infinity is a machine identity with create-only access. Browser sessions are not used.
-- Private file settings take effect on each request without a process restart.
SET infinity_method = sqlpage.request_method();
SET infinity_key = sqlpage.header('x-api-key');
SET infinity_settings = sqlpage.read_file_as_text('sqlpage/infinity_ticket_config.json');
SET infinity_enabled = COALESCE(TRY_CONVERT(INT, JSON_VALUE($infinity_settings, '$.enabled')), 0);
SET infinity_expected_hash_text = JSON_VALUE($infinity_settings, '$.apiKeySha256');
-- Intake always belongs to Call Centre, regardless of request or old private config values.
SET infinity_department = 'CC';
SET infinity_content_type = LOWER(COALESCE(sqlpage.header('content-type'), ''));
-- The JSON adapter forwards POST-only form fields for SQLPage 0.25 compatibility.
-- Camel-case form aliases also match the external contract; URL parameters cannot supply them.
SET infinity_category = COALESCE(NULLIF(LTRIM(RTRIM(CAST(:category AS NVARCHAR(MAX)))), ''), 'Event follow up');
-- Recovery requests always take the highest urgency, including when a caller supplies a lower priority.
SET infinity_priority = CASE
    WHEN LOWER($infinity_category) = 'dispatch recovery team' THEN 'Critical'
    ELSE COALESCE(NULLIF(LTRIM(RTRIM(CAST(:priority AS NVARCHAR(MAX)))), ''), 'Medium')
END;
SET infinity_created_by = CAST(COALESCE(:createdBy, :created_by) AS NVARCHAR(MAX));
SET infinity_description = CAST(:description AS NVARCHAR(MAX));
SET infinity_registration = CAST(:registration AS NVARCHAR(MAX));
SET infinity_client_name = CAST(COALESCE(:clientName, :client_name) AS NVARCHAR(MAX));
SET infinity_client_contact = CAST(COALESCE(:clientContactNo, :client_contact) AS NVARCHAR(MAX));
-- SQLPage 0.25 binds SET strings as VARCHAR; measure NVARCHAR storage explicitly.
SET infinity_input_bytes = COALESCE(DATALENGTH(CAST($infinity_category AS NVARCHAR(MAX))), 0)
    + COALESCE(DATALENGTH(CAST($infinity_description AS NVARCHAR(MAX))), 0)
    + COALESCE(DATALENGTH(CAST($infinity_registration AS NVARCHAR(MAX))), 0)
    + COALESCE(DATALENGTH(CAST($infinity_created_by AS NVARCHAR(MAX))), 0)
    + COALESCE(DATALENGTH(CAST($infinity_client_name AS NVARCHAR(MAX))), 0)
    + COALESCE(DATALENGTH(CAST($infinity_client_contact AS NVARCHAR(MAX))), 0);

SET infinity_error_status = CASE
    WHEN $infinity_method <> 'POST' THEN 405
    WHEN $infinity_enabled <> 1 THEN 503
    WHEN LEN(COALESCE($infinity_expected_hash_text, '')) <> 64 OR TRY_CONVERT(VARBINARY(32), $infinity_expected_hash_text, 2) IS NULL THEN 503
    WHEN $infinity_key IS NULL OR LEN($infinity_key) NOT BETWEEN 32 AND 256 THEN 401
    WHEN HASHBYTES('SHA2_256', CAST($infinity_key AS VARCHAR(MAX))) <> TRY_CONVERT(VARBINARY(32), $infinity_expected_hash_text, 2) THEN 401
    WHEN $infinity_content_type <> 'application/x-www-form-urlencoded' AND $infinity_content_type NOT LIKE 'application/x-www-form-urlencoded;%' THEN 415
    WHEN $infinity_input_bytes > 131072 THEN 413
    WHEN $infinity_priority NOT IN ('Low', 'Medium', 'High', 'Critical') THEN 400
    WHEN NULLIF(LTRIM(RTRIM($infinity_category)), '') IS NULL OR DATALENGTH(CAST($infinity_category AS NVARCHAR(MAX))) > 200 THEN 400
    WHEN NULLIF(LTRIM(RTRIM($infinity_description)), '') IS NULL THEN 400
    WHEN NULLIF(LTRIM(RTRIM($infinity_created_by)), '') IS NULL OR DATALENGTH(CAST($infinity_created_by AS NVARCHAR(MAX))) > 240 THEN 400
    WHEN NULLIF(LTRIM(RTRIM($infinity_registration)), '') IS NULL THEN 400
    WHEN NULLIF(LTRIM(RTRIM($infinity_client_name)), '') IS NULL OR DATALENGTH(CAST($infinity_client_name AS NVARCHAR(MAX))) > 200 THEN 400
    WHEN NULLIF(LTRIM(RTRIM($infinity_client_contact)), '') IS NULL OR DATALENGTH(CAST($infinity_client_contact AS NVARCHAR(MAX))) > 100 THEN 400
    ELSE NULL
END;

-- Department, machine group, and internal user identity are controlled by the server.
-- The supplied external creator name does not select an internal user account.
-- Registration and client contact are free text without vehicle/phone lookups.
-- Normal database defaults still generate the internal ticket number and initial status.
SELECT 'http_header' AS component, 'no-store' AS [Cache-Control];
SELECT 'http_header' AS component, 'POST' AS [Allow] WHERE $infinity_error_status = 405;
-- If a query fails and SQLPage renders an error, preserve a failure HTTP status.
SELECT 'status_code' AS component, 500 AS status;
INSERT INTO CC.dbo.tkt_InternalTickets
    (Title, Department, Priority, Category, reg_no, c_name, c_contact, c_contacted,
     Description, RequestedByUserID, RequesterGroup, ExternalCreatedBy)
SELECT
    LTRIM(RTRIM($infinity_category)),
    $infinity_department,
    $infinity_priority,
    LTRIM(RTRIM($infinity_category)),
    LEFT(COALESCE($infinity_registration, ''), 50),
    LTRIM(RTRIM($infinity_client_name)),
    LTRIM(RTRIM($infinity_client_contact)),
    0,
    $infinity_description,
    NULL,
    'Infinity',
    LTRIM(RTRIM($infinity_created_by))
WHERE $infinity_error_status IS NULL;

-- Report the result only after the insert completes.
SELECT 'status_code' AS component, COALESCE($infinity_error_status, 204) AS status;
SELECT 'json' AS component,
    (SELECT $infinity_error_status AS status,
        CASE $infinity_error_status
            WHEN 400 THEN 'Supply createdBy, description, registration, clientName and clientContactNo within field limits. Category defaults to Event follow up; priority defaults to Medium.'
            WHEN 401 THEN 'Invalid API credentials.'
            WHEN 405 THEN 'Use POST.'
            WHEN 413 THEN 'Request body is too large.'
            WHEN 415 THEN 'Use Content-Type: application/x-www-form-urlencoded.'
            WHEN 503 THEN 'Infinity ticket intake is not configured.'
        END AS message
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents
WHERE $infinity_error_status IS NOT NULL;
