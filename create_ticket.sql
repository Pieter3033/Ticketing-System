-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

SET department_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:department, '') AS NVARCHAR(100)))), 100);
SET requester_group_value = CASE WHEN $ticket_is_requester = 1 THEN $ticket_requester_group ELSE 'Internal' END;
SET priority_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:priority, '') AS NVARCHAR(20)))), 20);
SET category_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:category, '') AS NVARCHAR(100)))), 100);
SET registration_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:registration, '') AS NVARCHAR(50)))), 50);
SET client_callback_value = CASE WHEN CAST(COALESCE(:client_callback, '') AS NVARCHAR(10)) = '1' THEN 1 ELSE 0 END;
SET client_name_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:client_name, '') AS NVARCHAR(100)))), 100);
SET client_contact_value = LEFT(LTRIM(RTRIM(CAST(COALESCE(:client_contact, '') AS NVARCHAR(50)))), 50);
SET description_value = CAST(COALESCE(:description, '') AS NVARCHAR(MAX));
SET attachment_file_name = NULLIF(LTRIM(RTRIM(sqlpage.uploaded_file_name('attachment'))), '');
SET created_ticket_id = NULL;
SET created_ticket_number = NULL;
SET insert_success = 0;
SET error_code = CASE
    WHEN $ticket_user_id IS NULL OR $ticket_user_type IS NULL THEN 'user_not_found'
    WHEN $department_value NOT IN ('Helpdesk', 'Pulscam', 'TAD', 'Software') THEN 'department_required'
    WHEN $department_value = 'Software' AND COALESCE($ticket_user_type, -1) <> 7 THEN 'software_access_denied'
    WHEN $ticket_user_type = 12 AND $department_value <> 'Helpdesk' THEN 'ibls_department_denied'
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
    $description_value,
    $ticket_user_id,
    $requester_group_value
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
          AND Description = $description_value
          AND RequestedByUserID = $ticket_user_id
          AND RequesterGroup = $requester_group_value
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
    $ticket_user_id
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
                WHEN 'user_not_found' THEN 'Your session could not be matched to an internal user record.'
                WHEN 'department_required' THEN 'Department is required.'
                WHEN 'software_access_denied' THEN 'Software tickets are limited to user type 7.'
                WHEN 'ibls_department_denied' THEN 'IBLS users can only create Helpdesk tickets.'
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
