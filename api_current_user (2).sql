-- Legacy duplicate route: requester users must use the canonical group-scoped ticket module.
SET legacy_ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SELECT 'redirect' AS component, '/internaltickets/index.html' AS link
WHERE JSON_VALUE($legacy_ticket_identity, '$[0].userId') IS NULL
   OR COALESCE(TRY_CONVERT(INT, JSON_VALUE($legacy_ticket_identity, '$[0].canManageRequesterGroups')), 0) <> 1;

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
        user_info.Seqno,
        user_info.Username,
        user_info.Name,
        user_info.Surname,
        user_info.Usertype
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
            cookie_user.username,
            resolved_user.Seqno AS userId,
            resolved_user.Name AS name,
            resolved_user.Surname AS surname,
            resolved_user.Usertype AS user_type
        FROM cookie_user
        LEFT JOIN resolved_user
            ON 1 = 1
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
