SET public_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET public_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($public_ticket_identity, '$[0].isRequester')), 0);
SET requester_name_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:requester_name, '') AS NVARCHAR(120)))), 120);
SET requester_contact_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:requester_contact, '') AS NVARCHAR(120)))), 120);
SET department_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:department, '') AS NVARCHAR(100)))), 100);
SET priority_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:priority, '') AS NVARCHAR(20)))), 20);
SET category_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:category, '') AS NVARCHAR(100)))), 100);
SET registration_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:registration, '') AS NVARCHAR(50)))), 50);
SET client_callback_value = CASE WHEN CAST(COALESCE(:client_callback, '') AS NVARCHAR(10)) = '1' THEN 1 ELSE 0 END;
SET client_name_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:client_name, '') AS NVARCHAR(100)))), 100);
SET client_contact_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:client_contact, '') AS NVARCHAR(50)))), 50);
SET description_value = CAST(COALESCE(:description, '') AS NVARCHAR(MAX));
SET ticket_description_value = CONCAT(
    'Submitted via public ticket form',
    CHAR(13) + CHAR(10),
    'Requester: ',
    $requester_name_value,
    CASE
        WHEN NULLIF($requester_contact_value, '') IS NOT NULL
            THEN CONCAT(CHAR(13) + CHAR(10), 'Requester contact: ', $requester_contact_value)
        ELSE ''
    END,
    CHAR(13) + CHAR(10) + CHAR(13) + CHAR(10),
    $description_value
);
SET attachment_file_name = NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('attachment'))), '');
SET created_ticket_id = NULL;
SET created_ticket_number = NULL;
SET insert_success = 0;
SET error_code = CASE
    WHEN $public_is_requester = 1 THEN 'requester_public_denied'
    WHEN $requester_name_value = '' THEN 'requester_required'
    WHEN $department_value = '' THEN 'department_required'
    WHEN $department_value = 'Software' THEN 'software_access_denied'
    WHEN $priority_value NOT IN ('Low', 'Medium', 'High', 'Critical') THEN 'priority_invalid'
    WHEN $category_value = '' THEN 'category_required'
    WHEN $registration_value = '' THEN 'registration_required'
    WHEN $description_value = '' THEN 'description_required'
    WHEN $client_callback_value = 1 AND ($client_name_value = '' OR $client_contact_value = '') THEN 'client_callback_required'
    ELSE NULL
END;

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
    RequestedByUserID,
    RequesterGroup
)
SELECT
    LEFT($category_value, 200),
    $department_value,
    $priority_value,
    $category_value,
    $registration_value,
    CASE WHEN $client_callback_value = 1 THEN $client_name_value ELSE NULL END,
    CASE WHEN $client_callback_value = 1 THEN $client_contact_value ELSE NULL END,
    0,
    $ticket_description_value,
    NULL,
    'Internal'
WHERE $error_code IS NULL;

SET created_ticket_id = CASE
    WHEN $error_code IS NULL THEN
    (
        SELECT TOP (1) TicketID
        FROM CC.dbo.tkt_InternalTickets
        WHERE Title = LEFT($category_value, 200)
          AND Department = $department_value
          AND Priority = $priority_value
          AND Category = $category_value
          AND reg_no = $registration_value
          AND Description = $ticket_description_value
          AND RequestedByUserID IS NULL
          AND RequesterGroup = 'Internal'
          AND IsDeleted = 0
        ORDER BY TicketID DESC
    )
    ELSE NULL
END;
SET created_ticket_number = (
    SELECT TOP (1) TicketNumber
    FROM CC.dbo.tkt_InternalTickets
    WHERE TicketID = $created_ticket_id
);
SET error_code = CASE WHEN $error_code IS NULL AND $created_ticket_id IS NULL THEN 'db_error' ELSE $error_code END;

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
    $created_ticket_id,
    LEFT($attachment_file_name, 255),
    sqlpage.persist_uploaded_file('attachment', 'sqlpage/internaltickets_attachments', 'jpg,jpeg,png,gif,bmp,webp,pdf,txt,doc,docx,xls,xlsx,csv,mp3,mp4,wav,avi,mov'),
    LEFT(sqlpage.uploaded_file_mime_type('attachment'), 150),
    NULL,
    NULL
WHERE $created_ticket_id IS NOT NULL
  AND $attachment_file_name IS NOT NULL
  AND NOT EXISTS
  (
      SELECT 1
      FROM CC.dbo.tkt_Attachments existing_attachment
      WHERE existing_attachment.TicketID = $created_ticket_id
        AND existing_attachment.IsDeleted = 0
  );

SET insert_success = CASE WHEN $created_ticket_id IS NOT NULL THEN 1 ELSE 0 END;

SELECT
    'json' AS component,
    (
        SELECT
            CAST(CASE WHEN $insert_success = 1 THEN 1 ELSE 0 END AS BIT) AS success,
            $created_ticket_id AS ticketId,
            $created_ticket_number AS ticketNumber,
            CASE $error_code
                WHEN 'requester_public_denied' THEN 'IBLS and CRM users must create tickets through their signed-in ticket form.'
                WHEN 'requester_required' THEN 'Requester name is required.'
                WHEN 'department_required' THEN 'Department is required.'
                WHEN 'software_access_denied' THEN 'Software tickets cannot be opened from the public form.'
                WHEN 'priority_invalid' THEN 'Priority is invalid.'
                WHEN 'category_required' THEN 'Category is required.'
                WHEN 'registration_required' THEN 'Registration is required.'
                WHEN 'description_required' THEN 'Description is required.'
                WHEN 'client_callback_required' THEN 'Client name and contact are required when client call back is selected.'
                WHEN 'db_error' THEN 'Database insert failed.'
                ELSE 'Ticket created.'
            END AS message
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
