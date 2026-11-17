-- Resolve access from the authenticated SQLPage session, never from supplied role/group fields.
SET ticket_identity = sqlpage.run_sql('sqlpage/internaltickets_access.sql');
SET ticket_user_id = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userId'));
SET ticket_user_type = TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].userType'));
SET ticket_is_requester = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].isRequester')), 0);
SET ticket_requester_group = JSON_VALUE($ticket_identity, '$[0].requesterGroup');
SET ticket_staff_access = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].canManageRequesterGroups')), 0);
SET software_access_allowed = COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].softwareAllowed')), 0);
SET ticket_manage_access = CASE WHEN $ticket_user_id IS NOT NULL AND $ticket_user_type IS NOT NULL AND $ticket_is_requester = 0 THEN 1 ELSE 0 END;

SELECT 'json' AS component,
(
    SELECT
        JSON_QUERY((
            SELECT
                comm_type.type AS label,
                comm_type.type AS value
            FROM Pulsit_comparison.dbo.CC_comm_types comm_type
            WHERE $ticket_user_type IN (7, 8, 14) AND LTRIM(RTRIM(ISNULL(comm_type.type, ''))) <> '...'
            ORDER BY comm_type.id
            FOR JSON PATH
        )) AS commTypes,
        JSON_QUERY((
            SELECT
                seat.seat AS label,
                seat.id AS value
            FROM Pulsit_comparison.dbo.cc_seats seat
            WHERE $ticket_user_type IN (7, 8, 14) AND LTRIM(RTRIM(ISNULL(seat.seat, ''))) <> '...'
            ORDER BY seat.id
            FOR JSON PATH
        )) AS seats
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS contents;
