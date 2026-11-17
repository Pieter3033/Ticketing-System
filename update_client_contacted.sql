-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

SET update_value = CASE WHEN TRY_CONVERT(INT, :contacted) = 1 THEN 1 ELSE 0 END;
-- SQLPage runs statements separately; verify eligibility and resulting state instead of connection row counts.
SET ticket_can_update = CASE WHEN EXISTS (
 SELECT 1 FROM CC.dbo.tkt_InternalTickets ticket WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id) AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1
 AND ticket.Status NOT IN ('Closed', 'Cancelled') AND (NULLIF(LTRIM(RTRIM(ticket.c_name)), '') IS NOT NULL OR NULLIF(LTRIM(RTRIM(ticket.c_contact)), '') IS NOT NULL)
) THEN 1 ELSE 0 END;
UPDATE ticket SET c_contacted = $update_value, UpdatedAt = SYSDATETIME()
FROM CC.dbo.tkt_InternalTickets ticket
WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id) AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1
 AND ticket.Status NOT IN ('Closed', 'Cancelled') AND (NULLIF(LTRIM(RTRIM(ticket.c_name)), '') IS NOT NULL OR NULLIF(LTRIM(RTRIM(ticket.c_contact)), '') IS NOT NULL)
 AND $ticket_can_update = 1;
SET ticket_updated = CASE WHEN $ticket_can_update = 1 AND EXISTS (
 SELECT 1 FROM CC.dbo.tkt_InternalTickets ticket
 WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id) AND ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
      AND $ticket_manage_access = 1
 AND ticket.c_contacted = $update_value
) THEN 1 ELSE 0 END;
SELECT 'json' AS component,
 (SELECT CAST($ticket_updated AS BIT) AS success,
 CASE WHEN $ticket_updated = 1 THEN TRY_CONVERT(INT, :ticket_id) END AS ticketId,
 CASE WHEN $ticket_updated = 1 THEN $update_value END AS clientContacted,
 CASE WHEN $ticket_updated = 1 THEN 'Client callback status updated.' ELSE 'Ticket could not be updated or access is denied.' END AS message
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;
