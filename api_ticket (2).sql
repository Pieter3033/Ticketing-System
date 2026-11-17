-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

SELECT 'json' AS component,
(
    SELECT
        JSON_QUERY((
            SELECT TOP (1)
                TicketID AS ticketId,
                TicketNumber AS ticketNumber,
                Department AS department,
                Priority AS priority,
                Category AS category,
                Status AS status,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(creator.Name, ' ', creator.Surname))), ''), NULLIF(LTRIM(RTRIM(creator.Username)), '')) AS createdBy,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(assignee.Name, ' ', assignee.Surname))), ''), NULLIF(LTRIM(RTRIM(assignee.Username)), '')) AS assignedToName,
                COALESCE(ticket.reg_no, '-') AS registration,
                COALESCE(ticket.c_name, '-') AS clientName,
                COALESCE(ticket.c_contact, '-') AS clientContact,
                COALESCE(ticket.zoho_ticketnum, '') AS zohoTicketNumber,
                CASE
                    WHEN NULLIF(LTRIM(RTRIM(COALESCE(ticket.c_name, ''))), '') IS NOT NULL
                      OR NULLIF(LTRIM(RTRIM(COALESCE(ticket.c_contact, ''))), '') IS NOT NULL
                    THEN CAST(1 AS BIT)
                    ELSE CAST(0 AS BIT)
                END AS clientCallbackRequired,
                COALESCE(ticket.c_contacted, 0) AS clientContacted,
                Description AS description,
                RequestedByUserID AS requestedByUserId,
                AssignedToUserID AS assignedToUserId,
                FORMAT(CreatedAt, 'yyyy-MM-dd HH:mm') AS createdAt,
                COALESCE(FORMAT(UpdatedAt, 'yyyy-MM-dd HH:mm'), '-') AS updatedAt,
                COALESCE(FORMAT(ClosedAt, 'yyyy-MM-dd HH:mm'), '-') AS closedAt
            FROM CC.dbo.tkt_InternalTickets ticket
            LEFT JOIN Jobcard.dbo.User_info creator
                ON creator.Seqno = ticket.RequestedByUserID
            LEFT JOIN Jobcard.dbo.User_info assignee
                ON assignee.Seqno = ticket.AssignedToUserID
            WHERE ticket.TicketID = TRY_CONVERT(INT, $ticket_id)
              AND ticket.IsDeleted = 0
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )) AS ticket,
        JSON_QUERY((
            SELECT
                CommentID AS commentId,
                Comment AS comment,
                [status] AS status,
                CommentedByUserID AS commentedByUserId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(commenter.Name, ' ', commenter.Surname))), ''), commenter.Username, CONCAT('User ', CommentedByUserID)) AS commentedByName,
                FORMAT(CommentedAt, 'yyyy-MM-dd HH:mm') AS commentedAt
            FROM CC.dbo.tkt_Comments
            LEFT JOIN Jobcard.dbo.User_info commenter
                ON commenter.Seqno = CommentedByUserID
            WHERE TicketID = TRY_CONVERT(INT, $ticket_id)
            ORDER BY CommentedAt DESC, CommentID DESC
            FOR JSON PATH
        )) AS comments,
        JSON_QUERY((
            SELECT TOP (1)
                AttachmentID AS attachmentId,
                OriginalFileName AS originalFileName,
                StoredFilePath AS storedFilePath,
                MimeType AS mimeType,
                FileSizeBytes AS fileSizeBytes,
                UploadedByUserID AS uploadedByUserId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(uploader.Name, ' ', uploader.Surname))), ''), uploader.Username, CONCAT('User ', UploadedByUserID)) AS uploadedByName,
                FORMAT(UploadedAt, 'yyyy-MM-dd HH:mm') AS uploadedAt
            FROM CC.dbo.tkt_Attachments attachment
            LEFT JOIN Jobcard.dbo.User_info uploader
                ON uploader.Seqno = attachment.UploadedByUserID
            WHERE attachment.TicketID = TRY_CONVERT(INT, $ticket_id)
              AND attachment.IsDeleted = 0
            ORDER BY AttachmentID DESC
            FOR JSON PATH
        )) AS attachments
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
