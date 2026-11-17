-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

WITH cookie_user AS
(
    SELECT NULLIF(LTRIM(RTRIM(CAST(JSON_VALUE($ticket_identity, '$[0].username') AS NVARCHAR(200)))), '') AS username
),
logged_in_user AS
(
    SELECT TOP (1)
        user_info.Seqno,
        user_info.Username,
        user_info.Usertype
    FROM cookie_user
    LEFT JOIN Jobcard.dbo.User_info user_info
        ON user_info.Username = cookie_user.username
    ORDER BY user_info.Seqno
),
access_check AS
(
    SELECT CASE WHEN EXISTS (SELECT 1 FROM logged_in_user WHERE Usertype = 7) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS accessAllowed
),
raw_params AS
(
    SELECT
        NULLIF(LTRIM(RTRIM(CAST($category AS NVARCHAR(100)))), '') AS category,
        NULLIF(LTRIM(RTRIM(CAST($operator_filter AS NVARCHAR(2000)))), '') AS operator_filter,
        NULLIF(LTRIM(RTRIM(CAST($date_from AS NVARCHAR(40)))), '') AS date_from,
        NULLIF(LTRIM(RTRIM(CAST($date_to AS NVARCHAR(40)))), '') AS date_to,
        TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM(CAST($contribution_filter AS NVARCHAR(20)))), '')) AS contribution_filter
),
request_params AS
(
    SELECT
        category,
        operator_filter AS operatorFilter,
        TRY_CONVERT(DATETIME2(0), REPLACE(date_from, 'T', ' ')) AS dateFrom,
        TRY_CONVERT(DATETIME2(0), REPLACE(date_to, 'T', ' ')) AS dateTo,
        CASE
            WHEN contribution_filter IS NULL OR contribution_filter < 1 THEN NULL
            ELSE contribution_filter
        END AS minCommunications
    FROM raw_params
),
operator_filter_values AS
(
    SELECT DISTINCT NULLIF(LTRIM(RTRIM(operator_value.value)), '') AS operatorName
    FROM request_params params
    CROSS APPLY STRING_SPLIT(params.operatorFilter, NCHAR(31)) operator_value
    WHERE params.operatorFilter IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(operator_value.value)), '') IS NOT NULL
),
base_logs AS
(
    SELECT
        quick_log.seqno,
        quick_log.datetime_opened,
        quick_log.datetime_comm,
        quick_log.[close],
        quick_log.incident_type,
        quick_log.reg_no,
        quick_log.company,
        quick_log.seat,
        quick_log.cc_operator,
        quick_log.comm_type,
        COALESCE(NULLIF(LTRIM(RTRIM(quick_log.incident_type)), ''), 'Uncategorised') AS categoryLabel,
        COALESCE(NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), ''), 'Unassigned') AS operatorLabel,
        COALESCE(NULLIF(LTRIM(RTRIM(quick_log.reg_no)), ''), '-') AS registrationLabel,
        COALESCE(NULLIF(LTRIM(RTRIM(quick_log.company)), ''), '-') AS departmentLabel,
        COALESCE(NULLIF(LTRIM(RTRIM(quick_log.seat)), ''), '-') AS seatLabel
    FROM Pulsit_comparison.dbo.CC_quick_log quick_log
    CROSS JOIN access_check access_check
    CROSS JOIN request_params params
    WHERE access_check.accessAllowed = 1
      AND (params.category IS NULL OR quick_log.incident_type = params.category)
      AND (params.dateFrom IS NULL OR quick_log.datetime_opened >= params.dateFrom)
      AND (params.dateTo IS NULL OR quick_log.datetime_opened <= params.dateTo)
      AND
      (
          params.operatorFilter IS NULL
          OR EXISTS
          (
              SELECT 1
              FROM operator_filter_values operator_value
              WHERE operator_value.operatorName = NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '')
          )
      )
),
scoped_comments AS
(
    SELECT
        comment.case_id,
        comment.cc_operator,
        comment.datetime_comm,
        comment.comm_id
    FROM CC.dbo.quick_log_Comments comment
    INNER JOIN base_logs quick_log
        ON quick_log.seqno = comment.case_id
),
comment_rollup AS
(
    SELECT
        comment.case_id,
        COUNT(*) AS contributionCount
    FROM scoped_comments comment
    GROUP BY comment.case_id
),
latest_comment AS
(
    SELECT
        ranked_comment.case_id,
        ranked_comment.datetime_comm
    FROM
    (
        SELECT
            comment.case_id,
            comment.datetime_comm,
            ROW_NUMBER() OVER
            (
                PARTITION BY comment.case_id
                ORDER BY comment.datetime_comm DESC, comment.comm_id DESC
            ) AS rowNumber
        FROM scoped_comments comment
    ) ranked_comment
    WHERE ranked_comment.rowNumber = 1
),
filtered_logs AS
(
    SELECT
        quick_log.*,
        COALESCE(comment_rollup.contributionCount, 0) AS contributionCount,
        latest_comment.datetime_comm AS latestCommentAt
    FROM base_logs quick_log
    LEFT JOIN comment_rollup
        ON comment_rollup.case_id = quick_log.seqno
    LEFT JOIN latest_comment
        ON latest_comment.case_id = quick_log.seqno
    CROSS JOIN request_params params
    WHERE params.minCommunications IS NULL
       OR COALESCE(comment_rollup.contributionCount, 0) >= params.minCommunications
)
SELECT
    'json' AS component,
    (
        SELECT
            (SELECT accessAllowed FROM access_check) AS accessAllowed,
            JSON_QUERY((
                SELECT
                    COALESCE(COUNT(*), 0) AS totalTicketsHandled,
                    COALESCE(SUM(contributionCount), 0) AS totalContributions,
                    COALESCE(SUM(CASE WHEN contributionCount > 0 THEN 1 ELSE 0 END), 0) AS totalTicketsContributedTo,
                    COALESCE(SUM(CASE WHEN ISNULL([close], 0) = 0 THEN 1 ELSE 0 END), 0) AS openTickets,
                    0 AS inProgressTickets,
                    COALESCE(SUM(CASE WHEN ISNULL([close], 0) <> 0 THEN 1 ELSE 0 END), 0) AS completedTickets
                FROM filtered_logs
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            )) AS metrics,
            JSON_QUERY((
                SELECT DISTINCT TOP (500)
                    quick_log.incident_type AS [value],
                    quick_log.incident_type AS [label]
                FROM Pulsit_comparison.dbo.CC_quick_log quick_log
                CROSS JOIN access_check access_check
                WHERE access_check.accessAllowed = 1
                  AND NULLIF(LTRIM(RTRIM(COALESCE(quick_log.incident_type, ''))), '') IS NOT NULL
                ORDER BY quick_log.incident_type
                FOR JSON PATH
            )) AS categories,
            JSON_QUERY((
                SELECT TOP (500)
                    operator_list.operatorName AS [value],
                    operator_list.operatorName AS [label]
                FROM
                (
                    SELECT DISTINCT NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') AS operatorName
                    FROM Pulsit_comparison.dbo.CC_quick_log quick_log
                    CROSS JOIN access_check access_check
                    WHERE access_check.accessAllowed = 1
                      AND NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') IS NOT NULL
                ) operator_list
                ORDER BY operator_list.operatorName
                FOR JSON PATH
            )) AS operators,
            JSON_QUERY((
                SELECT TOP (12)
                    quick_log.categoryLabel AS category,
                    COUNT(*) AS ticketCount,
                    COALESCE(SUM(quick_log.contributionCount), 0) AS contributionCount
                FROM filtered_logs quick_log
                GROUP BY quick_log.categoryLabel
                ORDER BY COUNT(*) DESC, quick_log.categoryLabel
                FOR JSON PATH
            )) AS ticketsByCategory,
            JSON_QUERY((
                SELECT TOP (50)
                    quick_log.operatorLabel AS userName,
                    NULL AS userId,
                    COUNT(*) AS eventCount
                FROM filtered_logs quick_log
                GROUP BY quick_log.operatorLabel
                ORDER BY COUNT(*) DESC, quick_log.operatorLabel
                FOR JSON PATH
            )) AS eventsByUser,
            JSON_QUERY((
                SELECT
                    quick_log.operatorLabel AS operatorName,
                    quick_log.categoryLabel AS category,
                    COUNT(*) AS logCount
                FROM filtered_logs quick_log
                GROUP BY quick_log.operatorLabel, quick_log.categoryLabel
                ORDER BY quick_log.operatorLabel, quick_log.categoryLabel
                FOR JSON PATH
            )) AS operatorEventTotals,
            JSON_QUERY((
                SELECT
                    quick_log.operatorLabel AS operatorName,
                    COUNT(*) AS callCount
                FROM filtered_logs quick_log
                WHERE UPPER(LTRIM(RTRIM(COALESCE(quick_log.comm_type, '')))) = 'CALL MADE'
                GROUP BY quick_log.operatorLabel
                ORDER BY COUNT(*) DESC, quick_log.operatorLabel
                FOR JSON PATH
            )) AS operatorCallMadeTotals,
            JSON_QUERY((
                SELECT TOP (50)
                    COALESCE(NULLIF(LTRIM(RTRIM(comment.cc_operator)), ''), 'Unassigned') AS userName,
                    NULL AS userId,
                    COUNT(*) AS contributionCount,
                    COUNT(DISTINCT comment.case_id) AS ticketCount
                FROM scoped_comments comment
                INNER JOIN filtered_logs quick_log
                    ON quick_log.seqno = comment.case_id
                GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(comment.cc_operator)), ''), 'Unassigned')
                ORDER BY COUNT(*) DESC, COUNT(DISTINCT comment.case_id) DESC, userName
                FOR JSON PATH
            )) AS contributionsByUser,
            JSON_QUERY((
                SELECT TOP (12)
                    quick_log.seqno AS ticketId,
                    CONCAT('#', quick_log.seqno) AS ticketNumber,
                    quick_log.categoryLabel AS category,
                    CONVERT(VARCHAR(16), quick_log.datetime_opened, 120) AS createdAt,
                    quick_log.contributionCount
                FROM filtered_logs quick_log
                WHERE quick_log.contributionCount > 0
                ORDER BY quick_log.contributionCount DESC, quick_log.seqno DESC
                FOR JSON PATH
            )) AS contributionsByTicket,
            JSON_QUERY((
                SELECT TOP (500)
                    quick_log.seqno AS ticketId,
                    CONCAT('#', quick_log.seqno) AS ticketNumber,
                    quick_log.categoryLabel AS category,
                    quick_log.registrationLabel AS registration,
                    quick_log.departmentLabel AS department,
                    quick_log.seatLabel AS priority,
                    CASE WHEN ISNULL(quick_log.[close], 0) = 0 THEN 'Open' ELSE 'Closed' END AS status,
                    quick_log.operatorLabel AS assignedToName,
                    COALESCE(CONVERT(VARCHAR(16), quick_log.datetime_opened, 120), '-') AS createdAt,
                    COALESCE
                    (
                        CONVERT(VARCHAR(16), quick_log.latestCommentAt, 120),
                        CONVERT(VARCHAR(16), quick_log.datetime_comm, 120),
                        '-'
                    ) AS closedAt,
                    quick_log.contributionCount
                FROM filtered_logs quick_log
                ORDER BY quick_log.datetime_opened DESC, quick_log.seqno DESC
                FOR JSON PATH
            )) AS closedTickets
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents
OPTION (RECOMPILE);
