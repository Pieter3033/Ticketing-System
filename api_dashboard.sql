-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

WITH access_check AS (SELECT CAST($software_access_allowed AS BIT) AS accessAllowed),
raw_params AS
(
    SELECT
        NULLIF(LTRIM(RTRIM(CAST($category AS NVARCHAR(100)))), '') AS category,
        NULLIF(LTRIM(RTRIM(CAST($date_from AS NVARCHAR(40)))), '') AS date_from,
        NULLIF(LTRIM(RTRIM(CAST($date_to AS NVARCHAR(40)))), '') AS date_to,
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST($contribution_filter AS NVARCHAR(20)))), '')) AS contribution_filter
),
request_params AS
(
    SELECT
        category,
        TRY_CONVERT(DATETIME2(0), REPLACE(date_from, 'T', ' ')) AS dateFrom,
        TRY_CONVERT(DATETIME2(0), REPLACE(date_to, 'T', ' ')) AS dateTo,
        CASE
            WHEN contribution_filter IS NULL OR contribution_filter < 1 THEN NULL
            ELSE contribution_filter
        END AS minContributions
    FROM raw_params
),
filtered_tickets AS
(
    SELECT ticket.*
    FROM CC.dbo.tkt_InternalTickets ticket
    CROSS JOIN access_check access_check
    CROSS JOIN request_params params
    WHERE access_check.accessAllowed = 1
      AND ticket.IsDeleted = 0
      AND (params.category IS NULL OR ticket.Category = params.category)
      AND (params.dateFrom IS NULL OR ticket.CreatedAt >= params.dateFrom)
      AND (params.dateTo IS NULL OR ticket.CreatedAt <= params.dateTo)
      AND
      (
          params.minContributions IS NULL
          OR
          (
              SELECT COUNT(*)
              FROM CC.dbo.tkt_Comments comment
              WHERE comment.TicketID = ticket.TicketID
          ) >= params.minContributions
      )
)
SELECT
    'json' AS component,
    (
        SELECT
            (SELECT accessAllowed FROM access_check) AS accessAllowed,
            JSON_QUERY((
                SELECT
                    -- There is no explicit handled flag in tkt_InternalTickets; this dashboard treats non-deleted tickets in the filtered created-date/category/contribution scope as handled tickets.
                    COALESCE((SELECT COUNT(*) FROM filtered_tickets), 0) AS totalTicketsHandled,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM CC.dbo.tkt_Comments comment
                        INNER JOIN filtered_tickets ticket
                            ON ticket.TicketID = comment.TicketID
                    ), 0) AS totalContributions,
                    COALESCE((
                        SELECT COUNT(DISTINCT comment.TicketID)
                        FROM CC.dbo.tkt_Comments comment
                        INNER JOIN filtered_tickets ticket
                            ON ticket.TicketID = comment.TicketID
                    ), 0) AS totalTicketsContributedTo,
                    COALESCE((SELECT COUNT(*) FROM filtered_tickets WHERE Status = 'Open'), 0) AS openTickets,
                    COALESCE((SELECT COUNT(*) FROM filtered_tickets WHERE Status = 'In Progress'), 0) AS inProgressTickets,
                    COALESCE((SELECT COUNT(*) FROM filtered_tickets WHERE Status IN ('Closed', 'Cancelled')), 0) AS completedTickets
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            )) AS metrics,
            JSON_QUERY((
                SELECT DISTINCT TOP (500)
                    ticket.Category AS [value],
                    ticket.Category AS [label]
                FROM CC.dbo.tkt_InternalTickets ticket
                CROSS JOIN access_check access_check
                WHERE access_check.accessAllowed = 1
                  AND ticket.IsDeleted = 0
                  AND NULLIF(LTRIM(RTRIM(COALESCE(ticket.Category, ''))), '') IS NOT NULL
                ORDER BY ticket.Category
                FOR JSON PATH
            )) AS categories,
            JSON_QUERY((
                SELECT TOP (12)
                    COALESCE(NULLIF(LTRIM(RTRIM(ticket.Category)), ''), 'Uncategorised') AS category,
                    COUNT(*) AS ticketCount,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM CC.dbo.tkt_Comments comment
                        INNER JOIN filtered_tickets scoped_ticket
                            ON scoped_ticket.TicketID = comment.TicketID
                        WHERE COALESCE(NULLIF(LTRIM(RTRIM(scoped_ticket.Category)), ''), 'Uncategorised') = COALESCE(NULLIF(LTRIM(RTRIM(ticket.Category)), ''), 'Uncategorised')
                    ), 0) AS contributionCount
                FROM filtered_tickets ticket
                GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(ticket.Category)), ''), 'Uncategorised')
                ORDER BY COUNT(*) DESC, category
                FOR JSON PATH
            )) AS ticketsByCategory,
            JSON_QUERY((
                SELECT TOP (12)
                    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(requester.Name, ' ', requester.Surname))), ''), requester.Username, 'Unassigned') AS userName,
                    ticket.RequestedByUserID AS userId,
                    COUNT(*) AS eventCount
                FROM filtered_tickets ticket
                LEFT JOIN Jobcard.dbo.User_info requester
                    ON requester.Seqno = ticket.RequestedByUserID
                GROUP BY
                    ticket.RequestedByUserID,
                    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(requester.Name, ' ', requester.Surname))), ''), requester.Username, 'Unassigned')
                ORDER BY COUNT(*) DESC, userName
                FOR JSON PATH
            )) AS eventsByUser,
            JSON_QUERY((
                SELECT TOP (500)
                    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(assignee.Name, ' ', assignee.Surname))), ''), assignee.Username, 'Unassigned') AS operatorName,
                    ticket.AssignedToUserID AS userId,
                    COUNT(*) AS ticketCount
                FROM filtered_tickets ticket
                LEFT JOIN Jobcard.dbo.User_info assignee
                    ON assignee.Seqno = ticket.AssignedToUserID
                GROUP BY
                    ticket.AssignedToUserID,
                    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(assignee.Name, ' ', assignee.Surname))), ''), assignee.Username, 'Unassigned')
                ORDER BY COUNT(*) DESC, operatorName
                FOR JSON PATH
            )) AS operatorTicketTotals,
            JSON_QUERY((
                SELECT TOP (12)
                    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(commenter.Name, ' ', commenter.Surname))), ''), commenter.Username, CONCAT('User ', comment.CommentedByUserID)) AS userName,
                    comment.CommentedByUserID AS userId,
                    COUNT(*) AS contributionCount,
                    COUNT(DISTINCT comment.TicketID) AS ticketCount
                FROM CC.dbo.tkt_Comments comment
                INNER JOIN filtered_tickets ticket
                    ON ticket.TicketID = comment.TicketID
                LEFT JOIN Jobcard.dbo.User_info commenter
                    ON commenter.Seqno = comment.CommentedByUserID
                GROUP BY
                    comment.CommentedByUserID,
                    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(commenter.Name, ' ', commenter.Surname))), ''), commenter.Username, CONCAT('User ', comment.CommentedByUserID))
                ORDER BY COUNT(*) DESC, COUNT(DISTINCT comment.TicketID) DESC, userName
                FOR JSON PATH
            )) AS contributionsByUser,
            JSON_QUERY((
                SELECT TOP (12)
                    ticket.TicketID AS ticketId,
                    ticket.TicketNumber AS ticketNumber,
                    COALESCE(NULLIF(LTRIM(RTRIM(ticket.Category)), ''), 'Uncategorised') AS category,
                    FORMAT(ticket.CreatedAt, 'yyyy-MM-dd HH:mm') AS createdAt,
                    COUNT(comment.CommentID) AS contributionCount
                FROM filtered_tickets ticket
                INNER JOIN CC.dbo.tkt_Comments comment
                    ON comment.TicketID = ticket.TicketID
                GROUP BY
                    ticket.TicketID,
                    ticket.TicketNumber,
                    COALESCE(NULLIF(LTRIM(RTRIM(ticket.Category)), ''), 'Uncategorised'),
                    FORMAT(ticket.CreatedAt, 'yyyy-MM-dd HH:mm')
                ORDER BY COUNT(comment.CommentID) DESC, ticket.TicketID DESC
                FOR JSON PATH
            )) AS contributionsByTicket,
            JSON_QUERY((
                SELECT TOP (200)
                    ticket.TicketID AS ticketId,
                    ticket.TicketNumber AS ticketNumber,
                    COALESCE(NULLIF(LTRIM(RTRIM(ticket.Category)), ''), 'Uncategorised') AS category,
                    COALESCE(ticket.reg_no, '-') AS registration,
                    ticket.Department AS department,
                    ticket.Priority AS priority,
                    ticket.Status AS status,
                    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(assignee.Name, ' ', assignee.Surname))), ''), assignee.Username, '-') AS assignedToName,
                    FORMAT(ticket.CreatedAt, 'yyyy-MM-dd HH:mm') AS createdAt,
                    COALESCE(FORMAT(ticket.ClosedAt, 'yyyy-MM-dd HH:mm'), '-') AS closedAt,
                    (
                        SELECT COUNT(*)
                        FROM CC.dbo.tkt_Comments comment
                        WHERE comment.TicketID = ticket.TicketID
                    ) AS contributionCount
                FROM filtered_tickets ticket
                LEFT JOIN Jobcard.dbo.User_info assignee
                    ON assignee.Seqno = ticket.AssignedToUserID
                WHERE ticket.Status IN ('Closed', 'Cancelled')
                ORDER BY ticket.ClosedAt DESC, ticket.CreatedAt DESC, ticket.TicketID DESC
                FOR JSON PATH
            )) AS closedTickets
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
