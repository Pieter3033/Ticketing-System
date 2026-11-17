-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

SELECT 'json' AS component,
(
    SELECT
        (
            SELECT COUNT(*)
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            CROSS JOIN
            (
                SELECT
                    NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
            ) cookie_user
            OUTER APPLY
            (
                SELECT TOP (1)
                    NULLIF(LTRIM(RTRIM(CONCAT(user_info.Name, ' ', user_info.Surname))), '') AS operator_name
                FROM Jobcard.dbo.User_info user_info
                WHERE user_info.Username = cookie_user.username
            ) current_operator
            WHERE ISNULL(quick_log.[close], 0) = 0
              AND NULLIF(LTRIM(RTRIM(quick_log.reg_no)), '') IS NOT NULL
              AND (
                    NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') = current_operator.operator_name
                    OR NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') = cookie_user.username
                  )
        ) AS totalOpenCount,
        JSON_QUERY((
            SELECT TOP (300)
                quick_log.seqno AS caseId,
                quick_log.reg_no AS regNo,
                quick_log.company AS company,
                quick_log.event AS eventName,
                quick_log.incident_type AS incidentType,
                quick_log.seat AS seat,
                quick_log.cc_operator AS ccOperator,
                quick_log.c_name AS contactName,
                quick_log.c_number AS contactNo,
                quick_log.comm_type AS commType,
                CONVERT(VARCHAR(16), quick_log.datetime_opened, 120) AS datetimeOpened,
                CONVERT(VARCHAR(16), quick_log.datetime_comm, 120) AS datetimeComm,
                quick_log.comments AS comments,
                quick_log.zoho_id AS zohoId,
                COALESCE(account.Account_Name, 'N/A') AS zohoAccount,
                (
                    SELECT COUNT(*)
                    FROM CC.dbo.quick_log_Comments comment
                    WHERE comment.case_id = quick_log.seqno
                ) AS commentCount,
                (
                    SELECT TOP (1) comment.comments
                    FROM CC.dbo.quick_log_Comments comment
                    WHERE comment.case_id = quick_log.seqno
                    ORDER BY comment.datetime_comm DESC, comment.comm_id DESC
                ) AS lastComment,
                JSON_QUERY((
                    SELECT
                        comment.comm_id AS commId,
                        comment.comm_type AS commType,
                        comment.contact_name AS contactName,
                        comment.contact_no AS contactNo,
                        comment.email_address AS emailAddress,
                        comment.comments AS comments,
                        comment.cc_operator AS ccOperator,
                        CONVERT(VARCHAR(16), comment.datetime_comm, 120) AS datetimeComm
                    FROM CC.dbo.quick_log_Comments comment
                    WHERE comment.case_id = quick_log.seqno
                    ORDER BY comment.datetime_comm ASC, comment.comm_id ASC
                    FOR JSON PATH
                )) AS communicationLog
            FROM Pulsit_comparison.dbo.CC_quick_log quick_log
            CROSS JOIN
            (
                SELECT
                    NULLIF(LTRIM(RTRIM(CAST(COALESCE(sqlpage.cookie('username'), sqlpage.cookie('Username')) AS NVARCHAR(200)))), '') AS username
            ) cookie_user
            OUTER APPLY
            (
                SELECT TOP (1)
                    NULLIF(LTRIM(RTRIM(CONCAT(user_info.Name, ' ', user_info.Surname))), '') AS operator_name
                FROM Jobcard.dbo.User_info user_info
                WHERE user_info.Username = cookie_user.username
            ) current_operator
            LEFT JOIN Pulsit_comparison.dbo.Accounts_ZOHO account
                ON TRY_CONVERT(NVARCHAR(100), account.zoho_id) = TRY_CONVERT(NVARCHAR(100), quick_log.zoho_id)
            WHERE ISNULL(quick_log.[close], 0) = 0
              AND NULLIF(LTRIM(RTRIM(quick_log.reg_no)), '') IS NOT NULL
              AND (
                    NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') = current_operator.operator_name
                    OR NULLIF(LTRIM(RTRIM(quick_log.cc_operator)), '') = cookie_user.username
                  )
            ORDER BY quick_log.datetime_opened DESC, quick_log.seqno DESC
            FOR JSON PATH
        )) AS logs
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
