-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

SELECT 'json' AS component,
(
    SELECT
        JSON_QUERY((
            SELECT
                (SELECT COUNT(*) FROM CC.dbo.tkt_InternalTickets WHERE IsDeleted = 0 AND Status = 'Open') AS openCount,
                (SELECT COUNT(*) FROM CC.dbo.tkt_InternalTickets WHERE IsDeleted = 0 AND Status = 'In Progress') AS inProgressCount,
                (SELECT COUNT(*) FROM CC.dbo.tkt_InternalTickets WHERE IsDeleted = 0 AND Status = 'Waiting on User') AS waitingCount,
                (SELECT COUNT(*) FROM CC.dbo.tkt_InternalTickets WHERE IsDeleted = 0 AND Department = 'Helpdesk' AND Status NOT IN ('Closed', 'Cancelled')) AS helpdeskCount,
                (SELECT COUNT(*) FROM CC.dbo.tkt_InternalTickets WHERE IsDeleted = 0 AND Department = 'TAD' AND Status NOT IN ('Closed', 'Cancelled')) AS tadCount,
                (SELECT COUNT(*) FROM CC.dbo.tkt_InternalTickets WHERE IsDeleted = 0 AND Status = 'Closed' AND CAST(ClosedAt AS DATE) = CAST(SYSDATETIME() AS DATE)) AS closedTodayCount
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )) AS stats,
        JSON_QUERY((
            SELECT v.[value], v.[label]
            FROM (VALUES ('Helpdesk', 'Helpdesk'), ('TAD', 'TAD')) v([value], [label])
            FOR JSON PATH
        )) AS departments,
        JSON_QUERY((
            SELECT DISTINCT TOP (500)
                CAST(COALESCE(ui.Seqno, t.AssignedToUserID) AS NVARCHAR(50)) AS [value],
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(ui.Name, ' ', ui.Surname))), ''), ui.Username, CONCAT('User ', t.AssignedToUserID)) AS [label]
            FROM CC.dbo.tkt_InternalTickets t
            LEFT JOIN Jobcard.dbo.User_info ui
                ON ui.Seqno = t.AssignedToUserID
            WHERE t.IsDeleted = 0
              AND t.AssignedToUserID IS NOT NULL
            ORDER BY [label]
            FOR JSON PATH
        )) AS assignedToUsers,
        JSON_QUERY((
            SELECT TOP (100)
                TicketID AS ticketId,
                TicketNumber AS ticketNumber,
                Department AS department,
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
            FROM CC.dbo.tkt_InternalTickets ticket
            LEFT JOIN Jobcard.dbo.User_info assignee
                ON assignee.Seqno = ticket.AssignedToUserID
            WHERE ticket.IsDeleted = 0
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
