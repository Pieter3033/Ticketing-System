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
 (SELECT JSON_VALUE($ticket_identity, '$[0].username') AS username, $ticket_user_id AS userId,
 JSON_VALUE($ticket_identity, '$[0].name') AS name, JSON_VALUE($ticket_identity, '$[0].surname') AS surname,
 $ticket_user_type AS user_type, TRY_CONVERT(BIT, JSON_VALUE($ticket_identity, '$[0].helpdesk')) AS helpdesk,
 CAST(COALESCE(TRY_CONVERT(INT, JSON_VALUE($ticket_identity, '$[0].sessionValid')), 0) AS BIT) AS session_valid,
 CAST(CASE WHEN $ticket_user_type = 12 THEN 1 ELSE 0 END AS BIT) AS is_ibls,
 CAST(CASE WHEN $ticket_user_type = 13 THEN 1 ELSE 0 END AS BIT) AS is_crm,
 $ticket_requester_group AS requester_group, CAST($ticket_staff_access AS BIT) AS can_manage_requester_groups,
 CAST($ticket_staff_access AS BIT) AS can_manage_ibls,
 CAST($ticket_manage_access AS BIT) AS can_manage_tickets
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS contents;
