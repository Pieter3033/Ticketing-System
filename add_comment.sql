-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

SET ticket_update_error = CASE
 WHEN $ticket_manage_access <> 1 THEN 'Access denied.'
 WHEN NULLIF(LTRIM(RTRIM(CAST(:comment AS NVARCHAR(MAX)))), '') IS NULL THEN 'Comment is required.'
 WHEN CAST(:priority AS NVARCHAR(20)) NOT IN ('Low', 'Medium', 'High', 'Critical') OR :priority IS NULL THEN 'Priority is invalid.'
 WHEN CAST(:status AS NVARCHAR(50)) NOT IN ('Open', 'In Progress', 'Waiting on User', 'Closed', 'Cancelled') OR :status IS NULL THEN 'Status is invalid.'
 WHEN EXISTS (SELECT 1 FROM CC.dbo.tkt_InternalTickets ticket WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id)
 AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1 AND :status = 'Closed'
 AND (NULLIF(LTRIM(RTRIM(ticket.c_name)), '') IS NOT NULL OR NULLIF(LTRIM(RTRIM(ticket.c_contact)), '') IS NOT NULL)
 AND COALESCE(ticket.c_contacted, 0) <> 1) THEN 'Client Contacted must be ticked before closing this ticket.'
 ELSE NULL END;
-- SQLPage runs statements separately; verify eligibility and resulting state instead of connection row counts.
SET ticket_can_update = CASE WHEN EXISTS (
 SELECT 1 FROM CC.dbo.tkt_InternalTickets ticket WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id) AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1
 AND ticket.Status NOT IN ('Closed', 'Cancelled') AND $ticket_update_error IS NULL
) THEN 1 ELSE 0 END;
UPDATE ticket SET Priority = CAST(:priority AS NVARCHAR(20)), Status = CAST(:status AS NVARCHAR(50)), UpdatedAt = SYSDATETIME(),
 ClosedAt = CASE WHEN :status = 'Closed' THEN COALESCE(ClosedAt, SYSDATETIME()) ELSE NULL END
FROM CC.dbo.tkt_InternalTickets ticket
WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id) AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1
 AND ticket.Status NOT IN ('Closed', 'Cancelled') AND $ticket_update_error IS NULL
 AND $ticket_can_update = 1;
SET ticket_updated = CASE WHEN $ticket_can_update = 1 AND EXISTS (
 SELECT 1 FROM CC.dbo.tkt_InternalTickets ticket
 WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id) AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1
 AND ticket.Priority = CAST(:priority AS NVARCHAR(20)) AND ticket.Status = CAST(:status AS NVARCHAR(50))
) THEN 1 ELSE 0 END;
SET comment_baseline_id = (SELECT COALESCE(MAX(CommentID), 0) FROM CC.dbo.tkt_Comments
 WHERE TicketID = TRY_CONVERT(INT, :ticket_id) AND CommentedByUserID = $ticket_user_id);
INSERT INTO CC.dbo.tkt_Comments (TicketID, Comment, CommentedByUserID, [status])
SELECT TRY_CONVERT(INT, :ticket_id), CAST(:comment AS NVARCHAR(MAX)), $ticket_user_id, CAST(:status AS NVARCHAR(50))
WHERE $ticket_updated = 1 AND EXISTS (SELECT 1 FROM CC.dbo.tkt_InternalTickets ticket
 WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id) AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1
 AND ticket.Priority = CAST(:priority AS NVARCHAR(20)) AND ticket.Status = CAST(:status AS NVARCHAR(50)));
SET created_comment_id = (SELECT TOP (1) CommentID FROM CC.dbo.tkt_Comments
 WHERE TicketID = TRY_CONVERT(INT, :ticket_id) AND CommentedByUserID = $ticket_user_id
 AND CommentID > TRY_CONVERT(INT, $comment_baseline_id)
 AND Comment = CAST(:comment AS NVARCHAR(MAX)) AND [status] = CAST(:status AS NVARCHAR(50))
 AND $ticket_updated = 1 ORDER BY CommentID DESC);
SET comment_added = CASE WHEN $ticket_updated = 1 AND $created_comment_id IS NOT NULL THEN 1 ELSE 0 END;
SELECT 'json' AS component,
 (SELECT CAST($comment_added AS BIT) AS success,
 CASE WHEN $comment_added = 1 THEN $created_comment_id END AS commentId,
 CASE WHEN $comment_added = 1 THEN 'Comment added.' ELSE COALESCE($ticket_update_error, 'Ticket is completed, unavailable, or access is denied.') END AS message
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;
