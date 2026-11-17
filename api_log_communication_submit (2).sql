-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

WITH request_data AS
(
    SELECT
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:case_id AS NVARCHAR(50)))), '')) AS case_id,
        NULLIF(LTRIM(RTRIM(CAST(:reg_no AS NVARCHAR(100)))), '') AS reg_no,
        NULLIF(LTRIM(RTRIM(CAST(:zoho_id AS NVARCHAR(100)))), '') AS zoho_id,
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:seat AS NVARCHAR(50)))), '')) AS seat_id,
        CASE WHEN CAST(:close_case AS NVARCHAR(10)) IN ('1', 'true', 'TRUE', 'on', 'ON') THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS close_case
),
selected_seat AS
(
    SELECT TOP (1)
        seat.seat
    FROM Pulsit_comparison.dbo.cc_seats seat
    CROSS JOIN request_data
    WHERE seat.id = request_data.seat_id
      AND LTRIM(RTRIM(ISNULL(seat.seat, ''))) <> '...'
)
UPDATE quick_log
SET
    reg_no = COALESCE(request_data.reg_no, quick_log.reg_no),
    zoho_id = COALESCE(request_data.zoho_id, quick_log.zoho_id),
    company = COALESCE(
        (
            SELECT TOP (1) vehicle.Company
            FROM Risk.dbo.vehicleinfo vehicle
            WHERE UPPER(LTRIM(RTRIM(vehicle.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
        ),
        (
            SELECT TOP (1) companies.Company
            FROM Jobcard.dbo.Companies companies
            WHERE TRY_CONVERT(NVARCHAR(100), companies.escallation_no) = request_data.zoho_id
            ORDER BY companies.Company
        ),
        quick_log.company
    ),
    seat = COALESCE(selected_seat.seat, quick_log.seat)
FROM Pulsit_comparison.dbo.CC_quick_log quick_log
CROSS JOIN request_data
LEFT JOIN selected_seat
    ON 1 = 1
WHERE request_data.case_id IS NOT NULL
  AND quick_log.seqno = request_data.case_id;

WITH request_data AS
(
    SELECT
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:case_id AS NVARCHAR(50)))), '')) AS case_id,
        NULLIF(LTRIM(RTRIM(CAST(:reg_no AS NVARCHAR(100)))), '') AS reg_no,
        NULLIF(LTRIM(RTRIM(CAST(:zoho_id AS NVARCHAR(100)))), '') AS zoho_id,
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:seat AS NVARCHAR(50)))), '')) AS seat_id
),
cookie_user AS
(
    SELECT NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
),
selected_seat AS
(
    SELECT TOP (1)
        seat.seat
    FROM Pulsit_comparison.dbo.cc_seats seat
    CROSS JOIN request_data
    WHERE seat.id = request_data.seat_id
      AND LTRIM(RTRIM(ISNULL(seat.seat, ''))) <> '...'
),
existing_case AS
(
    SELECT COALESCE
    (
        request_data.case_id,
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
              AND (
                    TRY_CONVERT(NVARCHAR(100), quick_log.zoho_id) = request_data.zoho_id
                    OR TRY_CONVERT(NVARCHAR(100), quick_log.Reference) = request_data.zoho_id
                  )
            ORDER BY quick_log.seqno DESC
        ),
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
            ORDER BY quick_log.seqno DESC
        )
    ) AS case_id
    FROM request_data
),
comment_rows AS
(
    SELECT
        TRY_CONVERT(INT, raw_row.[key]) AS row_index,
        CAST(JSON_VALUE(raw_row.value, '$.comm_type') AS NVARCHAR(100)) AS comm_type,
        CAST(JSON_VALUE(raw_row.value, '$.contact_name') AS NVARCHAR(200)) AS contact_name,
        CAST(JSON_VALUE(raw_row.value, '$.contact_no') AS NVARCHAR(100)) AS contact_no,
        CAST(JSON_VALUE(raw_row.value, '$.email_address') AS NVARCHAR(200)) AS email_address,
        CAST(JSON_VALUE(raw_row.value, '$.comments') AS NVARCHAR(MAX)) AS comments,
        CAST(JSON_VALUE(raw_row.value, '$.datetime_comm') AS NVARCHAR(30)) AS datetime_comm
    FROM OPENJSON(COALESCE(NULLIF(CAST(:comments_json AS NVARCHAR(MAX)), ''), '[]')) raw_row
),
first_comment AS
(
    SELECT TOP (1)
        comment_rows.comm_type,
        comment_rows.contact_name,
        comment_rows.contact_no,
        comment_rows.comments,
        comment_rows.datetime_comm
    FROM comment_rows
    WHERE NULLIF(LTRIM(RTRIM(comment_rows.comments)), '') IS NOT NULL
    ORDER BY comment_rows.row_index
)
INSERT INTO Pulsit_comparison.dbo.CC_quick_log
(
    reg_no,
    company,
    event,
    datetime_opened,
    incident_type,
    seat,
    cc_operator,
    c_name,
    c_number,
    comm_type,
    datetime_comm,
    comments,
    zoho_id,
    [close]
)
SELECT
    request_data.reg_no,
    COALESCE(
        (
            SELECT TOP (1) vehicle.Company
            FROM Risk.dbo.vehicleinfo vehicle
            WHERE UPPER(LTRIM(RTRIM(vehicle.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
        ),
        (
            SELECT TOP (1) companies.Company
            FROM Jobcard.dbo.Companies companies
            WHERE TRY_CONVERT(NVARCHAR(100), companies.escallation_no) = request_data.zoho_id
            ORDER BY companies.Company
        )
    ),
    'Quick Log',
    GETDATE(),
    'Quick Log',
    selected_seat.seat,
    COALESCE(
        NULLIF(LTRIM(RTRIM(CONCAT(user_info.Name, ' ', user_info.Surname))), ''),
        cookie_user.username,
        'Unknown operator'
    ),
    first_comment.contact_name,
    first_comment.contact_no,
    first_comment.comm_type,
    COALESCE(TRY_CONVERT(DATETIME, first_comment.datetime_comm, 120), TRY_CONVERT(DATETIME, first_comment.datetime_comm), GETDATE()),
    first_comment.comments,
    request_data.zoho_id,
    0
FROM request_data
CROSS JOIN cookie_user
CROSS JOIN existing_case
LEFT JOIN Jobcard.dbo.User_info user_info
    ON user_info.Username = cookie_user.username
CROSS JOIN selected_seat
CROSS JOIN first_comment
WHERE request_data.case_id IS NULL
  AND existing_case.case_id IS NULL
  AND request_data.reg_no IS NOT NULL
  AND request_data.zoho_id IS NOT NULL;

WITH request_data AS
(
    SELECT
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:case_id AS NVARCHAR(50)))), '')) AS case_id,
        NULLIF(LTRIM(RTRIM(CAST(:reg_no AS NVARCHAR(100)))), '') AS reg_no,
        NULLIF(LTRIM(RTRIM(CAST(:zoho_id AS NVARCHAR(100)))), '') AS zoho_id
),
cookie_user AS
(
    SELECT NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
),
case_lookup AS
(
    SELECT COALESCE
    (
        request_data.case_id,
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
              AND (
                    TRY_CONVERT(NVARCHAR(100), quick_log.zoho_id) = request_data.zoho_id
                    OR TRY_CONVERT(NVARCHAR(100), quick_log.Reference) = request_data.zoho_id
                  )
            ORDER BY quick_log.seqno DESC
        ),
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
            ORDER BY quick_log.seqno DESC
        )
    ) AS case_id
    FROM request_data
),
comment_rows AS
(
    SELECT
        CAST(JSON_VALUE(raw_row.value, '$.comm_type') AS NVARCHAR(100)) AS comm_type,
        CAST(JSON_VALUE(raw_row.value, '$.contact_name') AS NVARCHAR(200)) AS contact_name,
        CAST(JSON_VALUE(raw_row.value, '$.contact_no') AS NVARCHAR(100)) AS contact_no,
        CAST(JSON_VALUE(raw_row.value, '$.email_address') AS NVARCHAR(200)) AS email_address,
        CAST(JSON_VALUE(raw_row.value, '$.comments') AS NVARCHAR(MAX)) AS comments,
        CAST(JSON_VALUE(raw_row.value, '$.datetime_comm') AS NVARCHAR(30)) AS datetime_comm
    FROM OPENJSON(COALESCE(NULLIF(CAST(:comments_json AS NVARCHAR(MAX)), ''), '[]')) raw_row
)
INSERT INTO CC.dbo.quick_log_Comments
(
    case_id,
    comm_type,
    contact_name,
    contact_no,
    email_address,
    comments,
    cc_operator,
    datetime_comm
)
SELECT
    case_lookup.case_id,
    NULLIF(LTRIM(RTRIM(row_data.comm_type)), ''),
    NULLIF(LTRIM(RTRIM(row_data.contact_name)), ''),
    NULLIF(LTRIM(RTRIM(row_data.contact_no)), ''),
    NULLIF(LTRIM(RTRIM(row_data.email_address)), ''),
    NULLIF(LTRIM(RTRIM(row_data.comments)), ''),
    COALESCE
    (
        NULLIF(LTRIM(RTRIM(CONCAT(user_info.Name, ' ', user_info.Surname))), ''),
        cookie_user.username,
        'Unknown operator'
    ),
    COALESCE(TRY_CONVERT(DATETIME, row_data.datetime_comm, 120), TRY_CONVERT(DATETIME, row_data.datetime_comm), GETDATE())
FROM request_data
CROSS JOIN case_lookup
CROSS JOIN cookie_user
LEFT JOIN Jobcard.dbo.User_info user_info
    ON user_info.Username = cookie_user.username
CROSS JOIN comment_rows row_data
WHERE case_lookup.case_id IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(row_data.comments)), '') IS NOT NULL;

WITH request_data AS
(
    SELECT
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:case_id AS NVARCHAR(50)))), '')) AS case_id,
        NULLIF(LTRIM(RTRIM(CAST(:reg_no AS NVARCHAR(100)))), '') AS reg_no,
        NULLIF(LTRIM(RTRIM(CAST(:zoho_id AS NVARCHAR(100)))), '') AS zoho_id,
        CASE WHEN CAST(:close_case AS NVARCHAR(10)) IN ('1', 'true', 'TRUE', 'on', 'ON') THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS close_case
),
case_lookup AS
(
    SELECT COALESCE
    (
        request_data.case_id,
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
              AND (
                    TRY_CONVERT(NVARCHAR(100), quick_log.zoho_id) = request_data.zoho_id
                    OR TRY_CONVERT(NVARCHAR(100), quick_log.Reference) = request_data.zoho_id
                  )
            ORDER BY quick_log.seqno DESC
        ),
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
            ORDER BY quick_log.seqno DESC
        )
    ) AS case_id,
    request_data.close_case
    FROM request_data
)
UPDATE quick_log
SET [close] = 1
FROM Pulsit_comparison.dbo.CC_quick_log quick_log
JOIN case_lookup
    ON case_lookup.case_id = quick_log.seqno
WHERE case_lookup.close_case = 1;

WITH request_data AS
(
    SELECT
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:case_id AS NVARCHAR(50)))), '')) AS case_id,
        NULLIF(LTRIM(RTRIM(CAST(:reg_no AS NVARCHAR(100)))), '') AS reg_no,
        NULLIF(LTRIM(RTRIM(CAST(:zoho_id AS NVARCHAR(100)))), '') AS zoho_id,
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST(:seat AS NVARCHAR(50)))), '')) AS seat_id,
        CASE WHEN CAST(:close_case AS NVARCHAR(10)) IN ('1', 'true', 'TRUE', 'on', 'ON') THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS close_case
),
case_lookup AS
(
    SELECT COALESCE
    (
        request_data.case_id,
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
              AND (
                    TRY_CONVERT(NVARCHAR(100), quick_log.zoho_id) = request_data.zoho_id
                    OR TRY_CONVERT(NVARCHAR(100), quick_log.Reference) = request_data.zoho_id
                  )
            ORDER BY quick_log.seqno DESC
        ),
        (
            SELECT TOP (1) quick_log.seqno
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            WHERE request_data.reg_no IS NOT NULL
              AND ISNULL(quick_log.[close], 0) = 0
              AND UPPER(LTRIM(RTRIM(quick_log.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg_no)))
            ORDER BY quick_log.seqno DESC
        )
    ) AS case_id,
    request_data.close_case,
    request_data.seat_id
    FROM request_data
),
comment_rows AS
(
    SELECT
        CAST(JSON_VALUE(raw_row.value, '$.comments') AS NVARCHAR(MAX)) AS comments
    FROM OPENJSON(COALESCE(NULLIF(CAST(:comments_json AS NVARCHAR(MAX)), ''), '[]')) raw_row
),
result_data AS
(
    SELECT
        case_lookup.case_id,
        case_lookup.close_case,
        (
            SELECT COUNT(*)
            FROM comment_rows
            WHERE NULLIF(LTRIM(RTRIM(comments)), '') IS NOT NULL
        ) AS submitted_comments,
        CASE
            WHEN EXISTS
            (
                SELECT 1
                FROM Pulsit_comparison.dbo.cc_seats seat
                WHERE seat.id = case_lookup.seat_id
                  AND LTRIM(RTRIM(ISNULL(seat.seat, ''))) <> '...'
            )
            THEN 1
            ELSE 0
        END AS valid_seat
    FROM case_lookup
)
SELECT
    'json' AS component,
    (
        SELECT
            CASE
                WHEN result_data.case_id IS NOT NULL
                 AND result_data.valid_seat = 1
                 AND (result_data.submitted_comments > 0 OR result_data.close_case = 1)
                THEN CAST(1 AS BIT)
                ELSE CAST(0 AS BIT)
            END AS success,
            result_data.case_id AS caseId,
            result_data.submitted_comments AS insertedComments,
            CASE
                WHEN result_data.valid_seat = 0 THEN 'Quick log could not be saved. Select a valid seat.'
                WHEN result_data.case_id IS NULL THEN 'Quick log could not be saved. No matching case was found or created.'
                WHEN result_data.submitted_comments = 0 AND result_data.close_case = 0 THEN 'Quick log could not be saved. Add at least one comment or close the case.'
                WHEN result_data.close_case = 1 THEN CONCAT(result_data.submitted_comments, ' communication row(s) saved and quick log closed.')
                ELSE CONCAT(result_data.submitted_comments, ' communication row(s) saved.')
            END AS message
        FROM result_data
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
