-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

UPDATE CC.dbo.tkt_InternalTickets
SET
    Priority = CAST(:priority AS NVARCHAR(20)),
    Status = CAST(:status AS NVARCHAR(50)),
    UpdatedAt = SYSDATETIME(),
    ClosedAt = CASE
        WHEN CAST(:status AS NVARCHAR(50)) = 'Closed' THEN COALESCE(ClosedAt, SYSDATETIME())
        WHEN CAST(:status AS NVARCHAR(50)) IN ('Open', 'In Progress', 'Waiting on User', 'Cancelled') THEN NULL
        ELSE ClosedAt
    END
WHERE TicketID = TRY_CONVERT(INT, :ticket_id)
  AND IsDeleted = 0
  AND CAST(:priority AS NVARCHAR(20)) IN ('Low', 'Medium', 'High', 'Critical')
  AND CAST(:status AS NVARCHAR(50)) IN ('Open', 'In Progress', 'Waiting on User', 'Closed', 'Cancelled')
  AND NOT
  (
      CAST(:status AS NVARCHAR(50)) = 'Closed'
      AND
      (
          NULLIF(LTRIM(RTRIM(COALESCE(c_name, ''))), '') IS NOT NULL
          OR NULLIF(LTRIM(RTRIM(COALESCE(c_contact, ''))), '') IS NOT NULL
      )
      AND COALESCE(c_contacted, 0) <> 1
  );

WITH cookie_user AS
(
    SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
),
cookie_identity AS
(
    SELECT
        cookie_user.username,
        LOWER(
            CASE
                WHEN cookie_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', cookie_parts.login_name) > 0 THEN LEFT(cookie_parts.login_name, CHARINDEX('@', cookie_parts.login_name) - 1)
                ELSE cookie_parts.login_name
            END
        ) AS canonical_username
    FROM cookie_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN cookie_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('\', REVERSE(cookie_user.username)) - 1)
                WHEN CHARINDEX('/', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('/', REVERSE(cookie_user.username)) - 1)
                ELSE cookie_user.username
            END AS login_name
    ) cookie_parts
),
resolved_user AS
(
    SELECT TOP (1)
        user_info.Seqno
    FROM cookie_identity
    JOIN Jobcard.dbo.User_info user_info
        ON cookie_identity.username IS NOT NULL
    CROSS APPLY
    (
        SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS username
    ) db_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN db_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
                WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
                ELSE db_user.username
            END AS login_name
    ) db_parts
    CROSS APPLY
    (
        SELECT LOWER(
            CASE
                WHEN db_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', db_parts.login_name) > 0 THEN LEFT(db_parts.login_name, CHARINDEX('@', db_parts.login_name) - 1)
                ELSE db_parts.login_name
            END
        ) AS canonical_username
    ) db_identity
    WHERE db_user.username = cookie_identity.username
       OR LOWER(db_user.username) = cookie_identity.canonical_username
       OR db_identity.canonical_username = cookie_identity.canonical_username
    ORDER BY
        CASE
            WHEN db_user.username = cookie_identity.username THEN 0
            WHEN LOWER(db_user.username) = cookie_identity.canonical_username THEN 1
            WHEN db_identity.canonical_username = cookie_identity.canonical_username THEN 2
            ELSE 3
        END,
        user_info.Seqno
)
INSERT INTO CC.dbo.tkt_Comments
(
    TicketID,
    Comment,
    CommentedByUserID,
    [status]
)
SELECT
    TRY_CONVERT(INT, :ticket_id),
    CAST(:comment AS NVARCHAR(MAX)),
    resolved_user.Seqno,
    CAST(:status AS NVARCHAR(50))
FROM resolved_user
WHERE TRY_CONVERT(INT, :ticket_id) IS NOT NULL
  AND EXISTS
  (
      SELECT 1
      FROM CC.dbo.tkt_InternalTickets
      WHERE TicketID = TRY_CONVERT(INT, :ticket_id)
        AND IsDeleted = 0
        AND NOT
        (
            CAST(:status AS NVARCHAR(50)) = 'Closed'
            AND
            (
                NULLIF(LTRIM(RTRIM(COALESCE(c_name, ''))), '') IS NOT NULL
                OR NULLIF(LTRIM(RTRIM(COALESCE(c_contact, ''))), '') IS NOT NULL
            )
            AND COALESCE(c_contacted, 0) <> 1
        )
  )
  AND NULLIF(LTRIM(RTRIM(CAST(:comment AS NVARCHAR(MAX)))), '') IS NOT NULL
  AND resolved_user.Seqno IS NOT NULL
  AND CAST(:priority AS NVARCHAR(20)) IN ('Low', 'Medium', 'High', 'Critical')
  AND CAST(:status AS NVARCHAR(50)) IN ('Open', 'In Progress', 'Closed', 'Cancelled');

WITH cookie_user AS
(
    SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
),
cookie_identity AS
(
    SELECT
        cookie_user.username,
        LOWER(
            CASE
                WHEN cookie_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', cookie_parts.login_name) > 0 THEN LEFT(cookie_parts.login_name, CHARINDEX('@', cookie_parts.login_name) - 1)
                ELSE cookie_parts.login_name
            END
        ) AS canonical_username
    FROM cookie_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN cookie_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('\', REVERSE(cookie_user.username)) - 1)
                WHEN CHARINDEX('/', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('/', REVERSE(cookie_user.username)) - 1)
                ELSE cookie_user.username
            END AS login_name
    ) cookie_parts
),
resolved_user AS
(
    SELECT TOP (1)
        user_info.Seqno
    FROM cookie_identity
    JOIN Jobcard.dbo.User_info user_info
        ON cookie_identity.username IS NOT NULL
    CROSS APPLY
    (
        SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS username
    ) db_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN db_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
                WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
                ELSE db_user.username
            END AS login_name
    ) db_parts
    CROSS APPLY
    (
        SELECT LOWER(
            CASE
                WHEN db_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', db_parts.login_name) > 0 THEN LEFT(db_parts.login_name, CHARINDEX('@', db_parts.login_name) - 1)
                ELSE db_parts.login_name
            END
        ) AS canonical_username
    ) db_identity
    WHERE db_user.username = cookie_identity.username
       OR LOWER(db_user.username) = cookie_identity.canonical_username
       OR db_identity.canonical_username = cookie_identity.canonical_username
    ORDER BY
        CASE
            WHEN db_user.username = cookie_identity.username THEN 0
            WHEN LOWER(db_user.username) = cookie_identity.canonical_username THEN 1
            WHEN db_identity.canonical_username = cookie_identity.canonical_username THEN 2
            ELSE 3
        END,
        user_info.Seqno
)
SELECT
    'json' AS component,
    (
        SELECT
            CASE
                WHEN EXISTS
                (
                    SELECT 1
                    FROM CC.dbo.tkt_InternalTickets ticket
                    WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id)
                      AND ticket.IsDeleted = 0
                      AND CAST(:status AS NVARCHAR(50)) = 'Closed'
                      AND
                      (
                          NULLIF(LTRIM(RTRIM(COALESCE(ticket.c_name, ''))), '') IS NOT NULL
                          OR NULLIF(LTRIM(RTRIM(COALESCE(ticket.c_contact, ''))), '') IS NOT NULL
                      )
                      AND COALESCE(ticket.c_contacted, 0) <> 1
                )
                THEN CAST(0 AS BIT)
                WHEN resolved_user.Seqno IS NULL THEN CAST(0 AS BIT)
                WHEN c.CommentID IS NULL THEN CAST(0 AS BIT)
                ELSE CAST(1 AS BIT)
            END AS success,
            c.CommentID AS commentId,
            CASE
                WHEN EXISTS
                (
                    SELECT 1
                    FROM CC.dbo.tkt_InternalTickets ticket
                    WHERE ticket.TicketID = TRY_CONVERT(INT, :ticket_id)
                      AND ticket.IsDeleted = 0
                      AND CAST(:status AS NVARCHAR(50)) = 'Closed'
                      AND
                      (
                          NULLIF(LTRIM(RTRIM(COALESCE(ticket.c_name, ''))), '') IS NOT NULL
                          OR NULLIF(LTRIM(RTRIM(COALESCE(ticket.c_contact, ''))), '') IS NOT NULL
                      )
                      AND COALESCE(ticket.c_contacted, 0) <> 1
                )
                THEN 'Client Contacted must be ticked before closing this ticket.'
                WHEN resolved_user.Seqno IS NULL THEN 'Your session could not be matched to an internal user record.'
                WHEN c.CommentID IS NOT NULL THEN 'Comment added.'
                ELSE 'Comment could not be added. Check your username cookie, comment text, or selected status/priority.'
            END AS message
        FROM (SELECT 1 AS x) seed
        LEFT JOIN resolved_user
            ON 1 = 1
        LEFT JOIN
        (
            SELECT TOP (1)
                CommentID
            FROM CC.dbo.tkt_Comments
            WHERE TicketID = TRY_CONVERT(INT, :ticket_id)
              AND Comment = CAST(:comment AS NVARCHAR(MAX))
              AND [status] = CAST(:status AS NVARCHAR(50))
            ORDER BY CommentID DESC
        ) c ON 1 = 1
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
