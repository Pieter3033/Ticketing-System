-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

SET attachment_path = (
 SELECT TOP (1) storage.read_path FROM CC.dbo.tkt_Attachments a
 JOIN CC.dbo.tkt_InternalTickets ticket ON ticket.TicketID = a.TicketID
 CROSS APPLY (SELECT REPLACE(a.StoredFilePath, '\', '/') AS normalized_path) stored
 -- Windows uploads have a URL-style leading slash; the disk reader needs a web-root-relative path.
 CROSS APPLY (SELECT CASE WHEN LEFT(stored.normalized_path, 1) = '/'
   THEN SUBSTRING(stored.normalized_path, 2, 4000)
   ELSE stored.normalized_path END AS normalized_path) normalized
 -- Older desktop records already have matching files in production's ticket attachment folder.
 CROSS APPLY (SELECT CASE WHEN LEFT(normalized.normalized_path, LEN('C:/Users/williamc/Desktop/Jobcards Official_3 - Risk Integrated- UI/internaltickets/attachments/')) = 'C:/Users/williamc/Desktop/Jobcards Official_3 - Risk Integrated- UI/internaltickets/attachments/'
   THEN 'internaltickets/attachments/' + SUBSTRING(normalized.normalized_path, LEN('C:/Users/williamc/Desktop/Jobcards Official_3 - Risk Integrated- UI/internaltickets/attachments/') + 1, 4000)
   ELSE normalized.normalized_path END AS read_path) storage
 WHERE a.AttachmentID = TRY_CONVERT(INT, $attachment_id) AND a.IsDeleted = 0 AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))

 AND (storage.read_path LIKE 'sqlpage/internaltickets[_]attachments/%'
      OR storage.read_path LIKE 'internaltickets[_]attachments/%'
      OR storage.read_path LIKE 'ticket[_]attachments/%'
      OR storage.read_path LIKE 'internaltickets/attachments/%'
      OR storage.read_path LIKE 'E:/SQLPage/sqlpage/internaltickets[_]attachments/%'
      OR storage.read_path LIKE 'E:/SQLPage/internaltickets[_]attachments/%')
 AND CHARINDEX('..', storage.read_path) = 0
);
SET attachment_filename = (SELECT OriginalFileName FROM CC.dbo.tkt_Attachments WHERE AttachmentID = TRY_CONVERT(INT, $attachment_id) AND $attachment_path IS NOT NULL);
SET attachment_data = sqlpage.read_file_as_data_url($attachment_path);
SELECT 'json' AS component,
 (SELECT CAST(CASE WHEN $attachment_path IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS success,
 $attachment_filename AS filename, $attachment_data AS dataUrl,
 CASE WHEN $attachment_path IS NULL THEN 'Attachment unavailable or access denied.' END AS message
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;
