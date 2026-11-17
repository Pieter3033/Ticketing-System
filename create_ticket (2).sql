-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

WITH cookie_user AS
(
    SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
),
cookie_identity AS
(
    SELECT
        cookie_user.username,
        LOWER(
            CASE
                WHEN cookie_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', cookie_parts.login_name) > 0 THEN LEFT(cookie_parts.login_name, CHARINDEX('@', cookie_parts.login_name) - 1)
                ELSE cookie_parts.login_name
            END
        ) AS canonical_username
    FROM cookie_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN cookie_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('\', REVERSE(cookie_user.username)) - 1)
                WHEN CHARINDEX('/', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('/', REVERSE(cookie_user.username)) - 1)
                ELSE cookie_user.username
            END AS login_name
    ) cookie_parts
),
resolved_user AS
(
    SELECT TOP (1)
        user_info.Seqno
    FROM cookie_identity
    JOIN Jobcard.dbo.User_info user_info
        ON cookie_identity.username IS NOT NULL
    CROSS APPLY
    (
        SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS username
    ) db_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN db_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
                WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
                ELSE db_user.username
            END AS login_name
    ) db_parts
    CROSS APPLY
    (
        SELECT LOWER(
            CASE
                WHEN db_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', db_parts.login_name) > 0 THEN LEFT(db_parts.login_name, CHARINDEX('@', db_parts.login_name) - 1)
                ELSE db_parts.login_name
            END
        ) AS canonical_username
    ) db_identity
    WHERE db_user.username = cookie_identity.username
       OR LOWER(db_user.username) = cookie_identity.canonical_username
       OR db_identity.canonical_username = cookie_identity.canonical_username
    ORDER BY
        CASE
            WHEN db_user.username = cookie_identity.username THEN 0
            WHEN LOWER(db_user.username) = cookie_identity.canonical_username THEN 1
            WHEN db_identity.canonical_username = cookie_identity.canonical_username THEN 2
            ELSE 3
        END,
        user_info.Seqno
)
INSERT INTO CC.dbo.tkt_InternalTickets
(
    Title,
    Department,
    Priority,
    Category,
    reg_no,
    c_name,
    c_contact,
    c_contacted,
    Description,
    RequestedByUserID
)
SELECT
    LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 200),
    LEFT(LTRIM(RTRIM(CAST(:department AS NVARCHAR(100)))), 100),
    CAST(:priority AS NVARCHAR(20)),
    LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 100),
    LEFT(LTRIM(RTRIM(CAST(:registration AS NVARCHAR(50)))), 50),
    CASE
        WHEN CAST(:client_callback AS NVARCHAR(10)) = '1' THEN LEFT(LTRIM(RTRIM(CAST(:client_name AS NVARCHAR(100)))), 100)
        ELSE NULL
    END,
    CASE
        WHEN CAST(:client_callback AS NVARCHAR(10)) = '1' THEN LEFT(LTRIM(RTRIM(CAST(:client_contact AS NVARCHAR(50)))), 50)
        ELSE NULL
    END,
    0,
    CAST(:description AS NVARCHAR(MAX)),
    resolved_user.Seqno
FROM resolved_user
WHERE NULLIF(LTRIM(RTRIM(CAST(:department AS NVARCHAR(100)))), '') IS NOT NULL
  AND CAST(:priority AS NVARCHAR(20)) IN ('Low', 'Medium', 'High', 'Critical')
  AND NULLIF(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(CAST(:registration AS NVARCHAR(50)))), '') IS NOT NULL
  AND (
      COALESCE(CAST(:client_callback AS NVARCHAR(10)), '') <> '1'
      OR (
          NULLIF(LTRIM(RTRIM(CAST(:client_name AS NVARCHAR(100)))), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(CAST(:client_contact AS NVARCHAR(50)))), '') IS NOT NULL
      )
  )
  AND NULLIF(LTRIM(RTRIM(CAST(:description AS NVARCHAR(MAX)))), '') IS NOT NULL
  AND resolved_user.Seqno IS NOT NULL;

WITH cookie_user AS
(
    SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
),
cookie_identity AS
(
    SELECT
        cookie_user.username,
        LOWER(
            CASE
                WHEN cookie_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', cookie_parts.login_name) > 0 THEN LEFT(cookie_parts.login_name, CHARINDEX('@', cookie_parts.login_name) - 1)
                ELSE cookie_parts.login_name
            END
        ) AS canonical_username
    FROM cookie_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN cookie_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('\', REVERSE(cookie_user.username)) - 1)
                WHEN CHARINDEX('/', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('/', REVERSE(cookie_user.username)) - 1)
                ELSE cookie_user.username
            END AS login_name
    ) cookie_parts
),
resolved_user AS
(
    SELECT TOP (1)
        user_info.Seqno
    FROM cookie_identity
    JOIN Jobcard.dbo.User_info user_info
        ON cookie_identity.username IS NOT NULL
    CROSS APPLY
    (
        SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS username
    ) db_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN db_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
                WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
                ELSE db_user.username
            END AS login_name
    ) db_parts
    CROSS APPLY
    (
        SELECT LOWER(
            CASE
                WHEN db_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', db_parts.login_name) > 0 THEN LEFT(db_parts.login_name, CHARINDEX('@', db_parts.login_name) - 1)
                ELSE db_parts.login_name
            END
        ) AS canonical_username
    ) db_identity
    WHERE db_user.username = cookie_identity.username
       OR LOWER(db_user.username) = cookie_identity.canonical_username
       OR db_identity.canonical_username = cookie_identity.canonical_username
    ORDER BY
        CASE
            WHEN db_user.username = cookie_identity.username THEN 0
            WHEN LOWER(db_user.username) = cookie_identity.canonical_username THEN 1
            WHEN db_identity.canonical_username = cookie_identity.canonical_username THEN 2
            ELSE 3
        END,
        user_info.Seqno
)
INSERT INTO CC.dbo.tkt_Attachments
(
    TicketID,
    OriginalFileName,
    StoredFilePath,
    MimeType,
    FileSizeBytes,
    UploadedByUserID
)
SELECT
    created_ticket.TicketID,
    LEFT(sqlpage.uploaded_file_name('attachment'), 255),
    uploaded_file.StoredFilePath,
    LEFT(sqlpage.uploaded_file_mime_type('attachment'), 150),
    NULL,
    resolved_user.Seqno
FROM
(
    SELECT TOP (1)
        ticket.TicketID
    FROM CC.dbo.tkt_InternalTickets ticket
    CROSS JOIN resolved_user matched_user
    WHERE ticket.Title = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 200)
      AND ticket.Department = LEFT(LTRIM(RTRIM(CAST(:department AS NVARCHAR(100)))), 100)
      AND ticket.Priority = CAST(:priority AS NVARCHAR(20))
      AND ticket.Category = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 100)
      AND ticket.reg_no = LEFT(LTRIM(RTRIM(CAST(:registration AS NVARCHAR(50)))), 50)
      AND ticket.Description = CAST(:description AS NVARCHAR(MAX))
      AND ticket.RequestedByUserID = matched_user.Seqno
      AND ticket.IsDeleted = 0
    ORDER BY ticket.TicketID DESC
) created_ticket
CROSS APPLY
(
    SELECT sqlpage.persist_uploaded_file('attachment', 'E:\SQLPage\internaltickets_attachments', 'jpg,jpeg,png,gif,bmp,webp,pdf,txt,doc,docx,xls,xlsx,csv,mp3,mp4,wav,avi,mov') AS StoredFilePath
    WHERE NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('attachment'))), '') IS NOT NULL
) uploaded_file
CROSS JOIN resolved_user
WHERE uploaded_file.StoredFilePath IS NOT NULL
  AND resolved_user.Seqno IS NOT NULL
  AND NOT EXISTS
  (
      SELECT 1
      FROM CC.dbo.tkt_Attachments existing_attachment
      WHERE existing_attachment.TicketID = created_ticket.TicketID
        AND existing_attachment.IsDeleted = 0
  );

WITH cookie_user AS
(
    SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
),
cookie_identity AS
(
    SELECT
        cookie_user.username,
        LOWER(
            CASE
                WHEN cookie_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', cookie_parts.login_name) > 0 THEN LEFT(cookie_parts.login_name, CHARINDEX('@', cookie_parts.login_name) - 1)
                ELSE cookie_parts.login_name
            END
        ) AS canonical_username
    FROM cookie_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN cookie_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('\', REVERSE(cookie_user.username)) - 1)
                WHEN CHARINDEX('/', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('/', REVERSE(cookie_user.username)) - 1)
                ELSE cookie_user.username
            END AS login_name
    ) cookie_parts
),
resolved_user AS
(
    SELECT TOP (1)
        user_info.Seqno
    FROM cookie_identity
    JOIN Jobcard.dbo.User_info user_info
        ON cookie_identity.username IS NOT NULL
    CROSS APPLY
    (
        SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS username
    ) db_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN db_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
                WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
                ELSE db_user.username
            END AS login_name
    ) db_parts
    CROSS APPLY
    (
        SELECT LOWER(
            CASE
                WHEN db_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', db_parts.login_name) > 0 THEN LEFT(db_parts.login_name, CHARINDEX('@', db_parts.login_name) - 1)
                ELSE db_parts.login_name
            END
        ) AS canonical_username
    ) db_identity
    WHERE db_user.username = cookie_identity.username
       OR LOWER(db_user.username) = cookie_identity.canonical_username
       OR db_identity.canonical_username = cookie_identity.canonical_username
    ORDER BY
        CASE
            WHEN db_user.username = cookie_identity.username THEN 0
            WHEN LOWER(db_user.username) = cookie_identity.canonical_username THEN 1
            WHEN db_identity.canonical_username = cookie_identity.canonical_username THEN 2
            ELSE 3
        END,
        user_info.Seqno
)
SELECT
    'json' AS component,
    (
        SELECT
            CASE
                WHEN resolved_user.Seqno IS NULL THEN CAST(0 AS BIT)
                WHEN t.TicketID IS NULL THEN CAST(0 AS BIT)
                ELSE CAST(1 AS BIT)
            END AS success,
            t.TicketID AS ticketId,
            t.TicketNumber AS ticketNumber,
            CASE
                WHEN resolved_user.Seqno IS NULL THEN 'Your session could not be matched to an internal user record.'
                WHEN t.TicketID IS NULL THEN 'Invalid ticket data.'
                ELSE 'Ticket created.'
            END AS message
        FROM (SELECT 1 AS x) seed
        LEFT JOIN
        (
            SELECT TOP (1)
                ticket.TicketID,
                ticket.TicketNumber
            FROM CC.dbo.tkt_InternalTickets ticket
            CROSS JOIN resolved_user matched_user
            WHERE ticket.Title = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 200)
              AND ticket.Department = LEFT(LTRIM(RTRIM(CAST(:department AS NVARCHAR(100)))), 100)
              AND ticket.Priority = CAST(:priority AS NVARCHAR(20))
              AND ticket.Category = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 100)
              AND ticket.reg_no = LEFT(LTRIM(RTRIM(CAST(:registration AS NVARCHAR(50)))), 50)
              AND ticket.Description = CAST(:description AS NVARCHAR(MAX))
              AND ticket.RequestedByUserID = matched_user.Seqno
              AND ticket.IsDeleted = 0
            ORDER BY ticket.TicketID DESC
        ) t ON 1 = 1
        LEFT JOIN resolved_user
            ON 1 = 1
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
