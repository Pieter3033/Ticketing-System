-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

WITH visible_tickets AS (
 SELECT ticket.* FROM CC.dbo.tkt_InternalTickets ticket
 WHERE ticket.IsDeleted = 0
      AND $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL
      AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
      AND (($ticket_is_requester = 1 AND ticket.RequesterGroup = $ticket_requester_group)
           OR ($ticket_is_requester = 0 AND (ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))
 AND ($ticket_is_requester = 1 OR NULLIF($requesterGroup, '') IS NULL OR ticket.RequesterGroup = $requesterGroup)
)
SELECT 'json' AS component,
(
    SELECT
        -- Capture creation progress across every ticket, including deleted rows and other views.
        -- A previously created ticket must not sound new when it becomes visible again.
        CASE WHEN $ticket_manage_access = 1 THEN (
            SELECT COALESCE(MAX(TicketID), 0) FROM CC.dbo.tkt_InternalTickets
        ) END AS latestCreatedTicketId,
        JSON_QUERY((
            SELECT
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Status = 'Open' AND (Department <> 'Software' OR $software_access_allowed = 1)) AS openCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Status = 'In Progress' AND (Department <> 'Software' OR $software_access_allowed = 1)) AS inProgressCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Status = 'Waiting on User' AND (Department <> 'Software' OR $software_access_allowed = 1)) AS waitingCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Department = 'Helpdesk' AND Status NOT IN ('Closed', 'Cancelled')) AS helpdeskCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Department = 'CC' AND Status NOT IN ('Closed', 'Cancelled')) AS callCentreCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Department = 'Pulscam' AND Status NOT IN ('Closed', 'Cancelled')) AS pulscamCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Department = 'TAD' AND Status NOT IN ('Closed', 'Cancelled')) AS tadCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Department = 'Software' AND $software_access_allowed = 1 AND Status NOT IN ('Closed', 'Cancelled')) AS softwareCount,
                (SELECT COUNT(*) FROM visible_tickets WHERE IsDeleted = 0 AND Status = 'Closed' AND CAST(ClosedAt AS DATE) = CAST(SYSDATETIME() AS DATE) AND (Department <> 'Software' OR $software_access_allowed = 1)) AS closedTodayCount
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )) AS stats,
        JSON_QUERY((
            SELECT v.[value], v.[label]
            FROM (VALUES ('Helpdesk', 'Helpdesk'), ('CC', 'Call Centre'), ('Pulscam', 'Pulscam'), ('TAD', 'TAD'), ('Software', 'Software')) v([value], [label])
            WHERE (v.[value] <> 'Software' OR $software_access_allowed = 1)
              AND (v.[value] <> 'CC' OR $ticket_is_requester = 0)
              AND ($ticket_user_type <> 12 OR v.[value] = 'Helpdesk')
            FOR JSON PATH
        )) AS departments,
        JSON_QUERY((
            SELECT DISTINCT TOP (500)
                CAST(COALESCE(ui.Seqno, t.AssignedToUserID) AS NVARCHAR(50)) AS [value],
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(ui.Name, ' ', ui.Surname))), ''), ui.Username, CONCAT('User ', t.AssignedToUserID)) AS [label]
            FROM visible_tickets t
            LEFT JOIN Jobcard.dbo.User_info ui
                ON ui.Seqno = t.AssignedToUserID
            WHERE t.IsDeleted = 0
              AND (t.Department <> 'Software' OR $software_access_allowed = 1)
              AND t.AssignedToUserID IS NOT NULL
            ORDER BY [label]
            FOR JSON PATH
        )) AS assignedToUsers,
        JSON_QUERY((
            SELECT TOP (100)
                TicketID AS ticketId,
                TicketNumber AS ticketNumber,
                Department AS department,
                RequesterGroup AS requesterGroup,
                Priority AS priority,
                Category AS category,
                COALESCE(ticket.reg_no, '-') AS registration,
                Status AS status,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(assignee.Name, ' ', assignee.Surname))), ''), NULLIF(LTRIM(RTRIM(assignee.Username)), '')) AS assignedToName,
                Description AS description,
                RequestedByUserID AS requestedByUserId,
                AssignedToUserID AS assignedToUserId,
                FORMAT(CreatedAt, 'yyyy-MM-dd HH:mm') AS createdAt,
                COALESCE(FORMAT(UpdatedAt, 'yyyy-MM-dd HH:mm'), '-') AS updatedAt,
                COALESCE(FORMAT(ClosedAt, 'yyyy-MM-dd HH:mm'), '-') AS closedAt
            FROM visible_tickets ticket
            LEFT JOIN Jobcard.dbo.User_info assignee
                ON assignee.Seqno = ticket.AssignedToUserID
            WHERE ticket.IsDeleted = 0
              AND (ticket.Department <> 'Software' OR $software_access_allowed = 1)
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($ticketNumber AS NVARCHAR(100)))), '') IS NULL
                  OR ticket.TicketNumber LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($ticketNumber AS NVARCHAR(100)))), '') + '%'
              )
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($category AS NVARCHAR(100)))), '') IS NULL
                  OR ticket.Category LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($category AS NVARCHAR(100)))), '') + '%'
              )
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($registration AS NVARCHAR(50)))), '') IS NULL
                  OR COALESCE(ticket.reg_no, '-') LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($registration AS NVARCHAR(50)))), '') + '%'
              )
              AND (NULLIF(LTRIM(RTRIM(CAST($department AS NVARCHAR(100)))), '') IS NULL OR ticket.Department = NULLIF(LTRIM(RTRIM(CAST($department AS NVARCHAR(100)))), ''))
              AND (NULLIF(LTRIM(RTRIM(CAST($priority AS NVARCHAR(20)))), '') IS NULL OR ticket.Priority = NULLIF(LTRIM(RTRIM(CAST($priority AS NVARCHAR(20)))), ''))
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($assignedTo AS NVARCHAR(50)))), '') IS NULL
                  OR CAST(assignee.Seqno AS NVARCHAR(50)) = NULLIF(LTRIM(RTRIM(CAST($assignedTo AS NVARCHAR(50)))), '')
              )
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($createdAt AS NVARCHAR(100)))), '') IS NULL
                  OR FORMAT(ticket.CreatedAt, 'yyyy-MM-dd HH:mm') LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($createdAt AS NVARCHAR(100)))), '') + '%'
              )
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($updatedAt AS NVARCHAR(100)))), '') IS NULL
                  OR COALESCE(FORMAT(ticket.UpdatedAt, 'yyyy-MM-dd HH:mm'), '-') LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($updatedAt AS NVARCHAR(100)))), '') + '%'
              )
              AND (
                  (
                      NULLIF(LTRIM(RTRIM(CAST($status AS NVARCHAR(50)))), '') IS NOT NULL
                      AND (
                          ticket.Status = NULLIF(LTRIM(RTRIM(CAST($status AS NVARCHAR(50)))), '')
                          OR (
                              NULLIF(LTRIM(RTRIM(CAST($status AS NVARCHAR(50)))), '') = 'Closed'
                              AND ticket.Status = 'Cancelled'
                          )
                      )
                  )
                  OR (
                      NULLIF(LTRIM(RTRIM(CAST($status AS NVARCHAR(50)))), '') IS NULL
                      AND ticket.Status NOT IN ('Closed', 'Cancelled')
                  )
              )
              AND (
                  NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') IS NULL
                  OR ticket.TicketNumber LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR ticket.Title LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR ticket.Department LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR ticket.Priority LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR ticket.Status LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR ticket.Category LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
                  OR COALESCE(ticket.reg_no, '-') LIKE '%' + NULLIF(LTRIM(RTRIM(CAST($search AS NVARCHAR(200)))), '') + '%'
              )
            ORDER BY ticket.CreatedAt DESC, ticket.TicketID DESC
            FOR JSON PATH
        )) AS tickets
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
