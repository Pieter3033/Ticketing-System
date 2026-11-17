-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

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
    CONCAT(
        'Submitted via public ticket form',
        CHAR(13) + CHAR(10),
        'Requester: ',
        LEFT(LTRIM(RTRIM(CAST(:requester_name AS NVARCHAR(120)))), 120),
        CASE
            WHEN NULLIF(LTRIM(RTRIM(CAST(:requester_contact AS NVARCHAR(120)))), '') IS NOT NULL
                THEN CONCAT(
                    CHAR(13) + CHAR(10),
                    'Requester contact: ',
                    LEFT(LTRIM(RTRIM(CAST(:requester_contact AS NVARCHAR(120)))), 120)
                )
            ELSE ''
        END,
        CHAR(13) + CHAR(10) + CHAR(13) + CHAR(10),
        CAST(:description AS NVARCHAR(MAX))
    ),
    NULL
WHERE NULLIF(LTRIM(RTRIM(CAST(:requester_name AS NVARCHAR(120)))), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(CAST(:department AS NVARCHAR(100)))), '') IS NOT NULL
  AND CAST(:priority AS NVARCHAR(20)) IN ('Low', 'Medium', 'High', 'Critical')
  AND NULLIF(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(CAST(:registration AS NVARCHAR(50)))), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(CAST(:description AS NVARCHAR(MAX)))), '') IS NOT NULL
  AND (
      COALESCE(CAST(:client_callback AS NVARCHAR(10)), '') <> '1'
      OR (
          NULLIF(LTRIM(RTRIM(CAST(:client_name AS NVARCHAR(100)))), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(CAST(:client_contact AS NVARCHAR(50)))), '') IS NOT NULL
      )
  );

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
    NULL
FROM
(
    SELECT TOP (1)
        TicketID
    FROM CC.dbo.tkt_InternalTickets
    WHERE Title = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 200)
      AND Department = LEFT(LTRIM(RTRIM(CAST(:department AS NVARCHAR(100)))), 100)
      AND Priority = CAST(:priority AS NVARCHAR(20))
      AND Category = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 100)
      AND reg_no = LEFT(LTRIM(RTRIM(CAST(:registration AS NVARCHAR(50)))), 50)
      AND Description = CONCAT(
            'Submitted via public ticket form',
            CHAR(13) + CHAR(10),
            'Requester: ',
            LEFT(LTRIM(RTRIM(CAST(:requester_name AS NVARCHAR(120)))), 120),
            CASE
                WHEN NULLIF(LTRIM(RTRIM(CAST(:requester_contact AS NVARCHAR(120)))), '') IS NOT NULL
                    THEN CONCAT(
                        CHAR(13) + CHAR(10),
                        'Requester contact: ',
                        LEFT(LTRIM(RTRIM(CAST(:requester_contact AS NVARCHAR(120)))), 120)
                    )
                ELSE ''
            END,
            CHAR(13) + CHAR(10) + CHAR(13) + CHAR(10),
            CAST(:description AS NVARCHAR(MAX))
        )
      AND IsDeleted = 0
    ORDER BY TicketID DESC
) created_ticket
CROSS APPLY
(
    SELECT sqlpage.persist_uploaded_file('attachment', 'E:\SQLPage\internaltickets_attachments', 'jpg,jpeg,png,gif,bmp,webp,pdf,txt,doc,docx,xls,xlsx,csv,mp3,mp4,wav,avi,mov') AS StoredFilePath
    WHERE NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('attachment'))), '') IS NOT NULL
) uploaded_file
WHERE uploaded_file.StoredFilePath IS NOT NULL
  AND NOT EXISTS
  (
      SELECT 1
      FROM CC.dbo.tkt_Attachments existing_attachment
      WHERE existing_attachment.TicketID = created_ticket.TicketID
        AND existing_attachment.IsDeleted = 0
  );

SELECT
    'json' AS component,
    (
        SELECT
            CASE WHEN t.TicketID IS NULL THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS success,
            t.TicketID AS ticketId,
            t.TicketNumber AS ticketNumber,
            CASE WHEN t.TicketID IS NULL THEN 'Invalid ticket data.' ELSE 'Ticket created.' END AS message
        FROM (SELECT 1 AS x) seed
        LEFT JOIN
        (
            SELECT TOP (1)
                TicketID,
                TicketNumber
            FROM CC.dbo.tkt_InternalTickets
            WHERE Title = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 200)
              AND Department = LEFT(LTRIM(RTRIM(CAST(:department AS NVARCHAR(100)))), 100)
              AND Priority = CAST(:priority AS NVARCHAR(20))
              AND Category = LEFT(LTRIM(RTRIM(CAST(:category AS NVARCHAR(100)))), 100)
              AND reg_no = LEFT(LTRIM(RTRIM(CAST(:registration AS NVARCHAR(50)))), 50)
              AND Description = CONCAT(
                    'Submitted via public ticket form',
                    CHAR(13) + CHAR(10),
                    'Requester: ',
                    LEFT(LTRIM(RTRIM(CAST(:requester_name AS NVARCHAR(120)))), 120),
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(CAST(:requester_contact AS NVARCHAR(120)))), '') IS NOT NULL
                            THEN CONCAT(
                                CHAR(13) + CHAR(10),
                                'Requester contact: ',
                                LEFT(LTRIM(RTRIM(CAST(:requester_contact AS NVARCHAR(120)))), 120)
                            )
                        ELSE ''
                    END,
                    CHAR(13) + CHAR(10) + CHAR(13) + CHAR(10),
                    CAST(:description AS NVARCHAR(MAX))
                )
              AND IsDeleted = 0
            ORDER BY TicketID DESC
        ) t ON 1 = 1
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
