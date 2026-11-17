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
                comm_type.type AS label,
                comm_type.type AS value
            FROM Pulsit_comparison.dbo.CC_comm_types comm_type
            WHERE LTRIM(RTRIM(ISNULL(comm_type.type, ''))) <> '...'
            ORDER BY comm_type.id
            FOR JSON PATH
        )) AS commTypes,
        JSON_QUERY((
            SELECT
                seat.seat AS label,
                seat.id AS value
            FROM Pulsit_comparison.dbo.cc_seats seat
            WHERE LTRIM(RTRIM(ISNULL(seat.seat, ''))) <> '...'
            ORDER BY seat.id
            FOR JSON PATH
        )) AS seats
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
